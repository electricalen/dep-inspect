import { analyzePackage } from '../../core/analysis/package.analyzer.js'
import { analyzeProjectFromLockfileData } from '../../core/analysis/project.analyzer.js'
import { buildRegistryLockfileForPackage } from '../../core/graph/registry-tree.builder.js'
import { formatError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import { EXIT_CODES } from '../../shared/types.js'
import { formatDeepInspect } from '../formatters/human.formatter.js'
import { formatDeepInspectJson } from '../formatters/json.formatter.js'
import { parsePackageSpec } from '../package-spec.js'
import { createAdapters } from './shared.js'

interface DeepInspectOptions {
  readonly json: boolean
  readonly github: boolean
  readonly details: boolean
  readonly strict: boolean
}

/**
 * `dep-inspect deep-inspect <package>` — walk the registry dependency tree from a root
 * package and run the same analysis pipeline as `scan`.
 */
export async function deepInspectCommand(
  packageSpec: string,
  opts: DeepInspectOptions,
): Promise<void> {
  const { name, version } = parsePackageSpec(packageSpec)
  const { registry, vulnerability, lockfile, github, policy, cleanup } = createAdapters({
    github: opts.github,
    strict: opts.strict,
  })

  try {
    logger.info(
      'Resolving transitive dependencies from the npm registry (approximate tree; may differ from your package manager lockfile).',
    )

    const lockResult = await buildRegistryLockfileForPackage(name, version, registry)
    if (lockResult.isErr()) {
      logger.error(formatError(lockResult.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    const lockfileData = lockResult.value
    const rootMetaResult = await registry.getPackageMetadata(name, version)
    if (rootMetaResult.isErr()) {
      logger.error(formatError(rootMetaResult.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    const rootMeta = rootMetaResult.value
    const packageJson = { dependencies: { [rootMeta.name]: rootMeta.version } }

    const [projectResult, rootPackageResult] = await Promise.all([
      analyzeProjectFromLockfileData(packageJson, lockfileData, {
        registry,
        vulnerability,
        lockfile,
        github,
        policy,
      }),
      analyzePackage(rootMeta.name, rootMeta.version, {
        registry,
        vulnerability,
        github,
        policy,
      }),
    ])

    if (projectResult.isErr()) {
      logger.error(formatError(projectResult.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    if (rootPackageResult.isErr()) {
      logger.error(formatError(rootPackageResult.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    if (opts.json) {
      console.log(formatDeepInspectJson(rootPackageResult.value, projectResult.value, policy))
    } else {
      console.log(
        formatDeepInspect(rootPackageResult.value, projectResult.value, policy, {
          details: opts.details,
        }),
      )
    }
  } finally {
    cleanup()
  }
}

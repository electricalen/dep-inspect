import { analyzePackage } from '../../core/analysis/package.analyzer.js'
import { formatError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import { EXIT_CODES } from '../../shared/types.js'
import { formatInspect } from '../formatters/human.formatter.js'
import { formatInspectJson } from '../formatters/json.formatter.js'
import { parsePackageSpec } from '../package-spec.js'
import { createAdapters } from './shared.js'

interface InspectOptions {
  readonly github: boolean
  readonly strict: boolean
  readonly json: boolean
}

/**
 * `dep-inspect inspect <package>` — inspect a single package.
 * GitHub data is ON by default (use --no-github to disable).
 */
export async function inspectCommand(packageSpec: string, opts: InspectOptions): Promise<void> {
  const { name, version } = parsePackageSpec(packageSpec)
  const { registry, vulnerability, github, policy, cleanup } = createAdapters({
    github: opts.github,
    strict: opts.strict,
  })

  try {
    const result = await analyzePackage(name, version, {
      registry,
      vulnerability,
      github,
      policy,
    })

    if (result.isErr()) {
      logger.error(formatError(result.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    if (opts.json) {
      console.log(formatInspectJson(result.value, policy))
    } else {
      console.log(formatInspect(result.value, policy))
    }
  } finally {
    cleanup()
  }
}

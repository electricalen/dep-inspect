import { ResultAsync } from 'neverthrow'
import semver from 'semver'

import type { LockfileData, LockfilePackage } from '../../adapters/lockfile/lockfile.types.js'
import type { RegistryPort } from '../../ports/registry.port.js'
import type { RegistryError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'

function hasInstallScriptScripts(scripts: Readonly<Record<string, string>> | undefined): boolean {
  if (!scripts) return false
  const keys = ['preinstall', 'install', 'postinstall', 'prepare'] as const
  return keys.some((k) => Boolean(scripts[k]))
}

function isNonRegistrySpec(range: string): boolean {
  const t = range.trim()
  return (
    t.startsWith('workspace:') ||
    t.startsWith('file:') ||
    t.startsWith('link:') ||
    t.startsWith('git+') ||
    t.startsWith('github:') ||
    t.startsWith('http:') ||
    t.startsWith('https:') ||
    t.startsWith('npm:')
  )
}

/**
 * Resolve a semver range to a concrete version using published versions from the registry.
 */
export function resolveRangeToVersion(
  range: string,
  allVersions: readonly string[],
): string | null {
  const trimmed = range.trim()
  if (!trimmed || isNonRegistrySpec(trimmed)) return null

  const validVersions = allVersions.filter((v) => semver.valid(v) !== null)
  const resolved = semver.maxSatisfying(validVersions, trimmed, { includePrerelease: true })
  return resolved
}

async function resolveDependencyVersion(
  registry: RegistryPort,
  depName: string,
  range: string,
): Promise<string | null> {
  const packumentMeta = await registry.getPackageMetadata(depName, undefined)
  if (packumentMeta.isErr()) return null
  return resolveRangeToVersion(range, packumentMeta.value.allVersions)
}

/**
 * Build normalized lockfile-shaped data by walking the npm registry from a root package,
 * resolving semver ranges to concrete versions (npm-style max-satisfying).
 *
 * This approximates an install tree; it will not match pnpm/npm hoisting or peer resolution exactly.
 */
export function buildRegistryLockfileForPackage(
  rootName: string,
  rootVersion: string | undefined,
  registry: RegistryPort,
): ResultAsync<LockfileData, RegistryError> {
  return registry.getPackageMetadata(rootName, rootVersion).andThen((rootMeta) =>
    ResultAsync.fromPromise(walkTree(rootMeta.name, rootMeta.version, registry), (e) => {
      if (typeof e === 'object' && e !== null && 'kind' in e) {
        return e as RegistryError
      }
      return {
        kind: 'registry' as const,
        message: e instanceof Error ? e.message : String(e),
        packageName: rootName,
      }
    }),
  )
}

async function walkTree(
  rootName: string,
  rootVersion: string,
  registry: RegistryPort,
): Promise<LockfileData> {
  const packages = new Map<string, LockfilePackage>()
  const queue: { name: string; version: string }[] = [{ name: rootName, version: rootVersion }]

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break

    const key = `${item.name}@${item.version}`
    if (packages.has(key)) continue

    const metaResult = await registry.getPackageMetadata(item.name, item.version)
    if (metaResult.isErr()) {
      if (packages.size === 0) {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- typed RegistryError for ResultAsync.fromPromise
        throw metaResult.error
      }
      logger.warn(`Could not fetch registry metadata for ${key}: ${metaResult.error.message}`)
      continue
    }

    const meta = metaResult.value
    const resolvedDeps: Record<string, string> = {}
    const resolvedOptional: Record<string, string> = {}

    const deps = meta.dependencies ?? {}
    for (const [depName, range] of Object.entries(deps)) {
      const resolved = await resolveDependencyVersion(registry, depName, range)
      if (!resolved) {
        logger.debug(`Could not resolve ${depName}@${range} (required by ${meta.name})`)
        continue
      }
      const verify = await registry.getPackageMetadata(depName, resolved)
      if (verify.isErr()) continue
      resolvedDeps[depName] = resolved
      queue.push({ name: depName, version: resolved })
    }

    const optDeps = meta.optionalDependencies ?? {}
    for (const [depName, range] of Object.entries(optDeps)) {
      const resolved = await resolveDependencyVersion(registry, depName, range)
      if (!resolved) continue
      const verify = await registry.getPackageMetadata(depName, resolved)
      if (verify.isErr()) continue
      resolvedOptional[depName] = resolved
      queue.push({ name: depName, version: resolved })
    }

    packages.set(key, {
      name: meta.name,
      version: meta.version,
      dependencies: Object.keys(resolvedDeps).length > 0 ? resolvedDeps : undefined,
      optionalDependencies: Object.keys(resolvedOptional).length > 0 ? resolvedOptional : undefined,
      dev: false,
      optional: false,
      hasInstallScript: hasInstallScriptScripts(meta.scripts),
    })
  }

  return { type: 'npm', packages }
}

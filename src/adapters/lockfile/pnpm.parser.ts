import * as fs from 'node:fs'

import { err, ok, type Result } from 'neverthrow'
import { parse as parseYaml } from 'yaml'

import type { LockfileParseError } from '../../shared/errors.js'
import type { FilePath } from '../../shared/types.js'
import type { LockfileData, LockfilePackage } from './lockfile.types.js'

interface PnpmLockfile {
  lockfileVersion?: string | number
  packages?: Record<string, PnpmPackageEntry>
}

interface PnpmPackageEntry {
  resolution?: { integrity?: string }
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dev?: boolean
  optional?: boolean
  hasBin?: boolean
  requiresBuild?: boolean
}

/**
 * Parse a pnpm-lock.yaml into normalized LockfileData.
 */
export function parsePnpmLockfile(filePath: FilePath): Result<LockfileData, LockfileParseError> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lock = parseYaml(content) as PnpmLockfile

    if (!lock.packages) {
      return err({
        kind: 'lockfile-parse',
        message: 'No "packages" field found in pnpm-lock.yaml',
        filePath,
      })
    }

    const packages = new Map<string, LockfilePackage>()

    for (const [pkgPath, entry] of Object.entries(lock.packages)) {
      const parsed = parsePnpmPackagePath(pkgPath)
      if (!parsed) continue

      const key = `${parsed.name}@${parsed.version}`
      if (packages.has(key)) continue

      packages.set(key, {
        name: parsed.name,
        version: parsed.version,
        integrity: entry.resolution?.integrity,
        dependencies: entry.dependencies,
        optionalDependencies: entry.optionalDependencies,
        dev: entry.dev === true,
        optional: entry.optional === true,
        hasInstallScript: entry.requiresBuild === true,
      })
    }

    return ok({ type: 'pnpm', packages })
  } catch (error) {
    return err({
      kind: 'lockfile-parse',
      message: error instanceof Error ? error.message : String(error),
      filePath,
    })
  }
}

/**
 * Parse a pnpm package path into name and version.
 * Formats:
 *   - "/@scope/name@version" or "/@scope/name/version"
 *   - "/name@version" or "/name/version"
 *   - "@scope/name@version" (lockfile v9+)
 *   - "name@version" (lockfile v9+)
 */
function parsePnpmPackagePath(pkgPath: string): { name: string; version: string } | null {
  let path = pkgPath

  // Strip leading slash
  if (path.startsWith('/')) {
    path = path.slice(1)
  }

  // Handle scoped packages: @scope/name@version or @scope/name/version
  if (path.startsWith('@')) {
    // Find the second @ or / that separates name from version
    const slashIdx = path.indexOf('/', path.indexOf('/') + 1)
    const atIdx = path.lastIndexOf('@')

    if (atIdx > 0 && atIdx > path.indexOf('/')) {
      return {
        name: path.slice(0, atIdx),
        version: path.slice(atIdx + 1),
      }
    }

    if (slashIdx > 0) {
      return {
        name: path.slice(0, slashIdx),
        version: path.slice(slashIdx + 1),
      }
    }

    return null
  }

  // Unscoped: name@version or name/version
  const atIdx = path.lastIndexOf('@')
  if (atIdx > 0) {
    return {
      name: path.slice(0, atIdx),
      version: path.slice(atIdx + 1),
    }
  }

  const slashIdx = path.indexOf('/')
  if (slashIdx > 0) {
    return {
      name: path.slice(0, slashIdx),
      version: path.slice(slashIdx + 1),
    }
  }

  return null
}

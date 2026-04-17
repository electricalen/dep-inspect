import * as fs from 'node:fs'

import { err, ok, type Result } from 'neverthrow'
import { parse as parseYaml } from 'yaml'

import type { LockfileParseError } from '../../shared/errors.js'
import type { FilePath } from '../../shared/types.js'
import type { LockfileData, LockfilePackage } from './lockfile.types.js'

interface PnpmLockfile {
  lockfileVersion?: string | number
  packages?: Record<string, PnpmPackageEntry>
  snapshots?: Record<string, PnpmPackageSnapshot>
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

interface PnpmPackageSnapshot {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
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
    const snapshotsByNormalizedKey = new Map<string, PnpmPackageSnapshot>()

    for (const [snapshotPath, snapshot] of Object.entries(lock.snapshots ?? {})) {
      const parsed = parsePnpmPackagePath(snapshotPath)
      if (!parsed) continue
      snapshotsByNormalizedKey.set(`${parsed.name}@${parsed.version}`, snapshot)
    }

    for (const [pkgPath, entry] of Object.entries(lock.packages)) {
      const parsed = parsePnpmPackagePath(pkgPath)
      if (!parsed) continue

      const key = `${parsed.name}@${parsed.version}`
      if (packages.has(key)) continue
      const snapshot = snapshotsByNormalizedKey.get(key)

      packages.set(key, {
        name: parsed.name,
        version: parsed.version,
        integrity: entry.resolution?.integrity,
        dependencies: snapshot?.dependencies ?? entry.dependencies,
        optionalDependencies: snapshot?.optionalDependencies ?? entry.optionalDependencies,
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
    const scopeSlashIdx = path.indexOf('/')
    const atIdx = path.indexOf('@', scopeSlashIdx + 1)
    const slashIdx = path.indexOf('/', scopeSlashIdx + 1)

    if (atIdx > 0) {
      return {
        name: path.slice(0, atIdx),
        version: stripPeerSuffix(path.slice(atIdx + 1)),
      }
    }

    if (slashIdx > 0) {
      return {
        name: path.slice(0, slashIdx),
        version: stripPeerSuffix(path.slice(slashIdx + 1)),
      }
    }

    return null
  }

  // Unscoped: name@version or name/version
  const atIdx = path.indexOf('@')
  if (atIdx > 0) {
    return {
      name: path.slice(0, atIdx),
      version: stripPeerSuffix(path.slice(atIdx + 1)),
    }
  }

  const slashIdx = path.indexOf('/')
  if (slashIdx > 0) {
    return {
      name: path.slice(0, slashIdx),
      version: stripPeerSuffix(path.slice(slashIdx + 1)),
    }
  }

  return null
}

function stripPeerSuffix(version: string): string {
  const peerIdx = version.indexOf('(')
  return peerIdx === -1 ? version : version.slice(0, peerIdx)
}

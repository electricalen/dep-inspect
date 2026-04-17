import * as fs from 'node:fs'

import { err, ok, type Result } from 'neverthrow'

import type { LockfileParseError } from '../../shared/errors.js'
import type { FilePath } from '../../shared/types.js'
import type { LockfileData, LockfilePackage } from './lockfile.types.js'

/**
 * Shape of package-lock.json v2/v3 `packages` entries.
 * v2 has both `packages` and `dependencies`; v3 only has `packages`.
 */
interface NpmLockPackageEntry {
  version?: string
  resolved?: string
  integrity?: string
  dev?: boolean
  optional?: boolean
  devOptional?: boolean
  link?: boolean
  hasInstallScript?: boolean
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

interface NpmLockfile {
  lockfileVersion?: number
  packages?: Record<string, NpmLockPackageEntry>
}

/**
 * Parse a package-lock.json (v2 or v3) into normalized LockfileData.
 */
export function parseNpmLockfile(filePath: FilePath): Result<LockfileData, LockfileParseError> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lock = JSON.parse(content) as NpmLockfile

    if (!lock.packages) {
      return err({
        kind: 'lockfile-parse',
        message: 'No "packages" field found. Only package-lock.json v2/v3 is supported.',
        filePath,
      })
    }

    const packages = new Map<string, LockfilePackage>()

    for (const [entryPath, entry] of Object.entries(lock.packages)) {
      // Skip the root entry (empty string key)
      if (entryPath === '') continue

      // Skip link entries
      if (entry.link) continue

      // Extract package name from the path
      // Format: "node_modules/pkg" or "node_modules/@scope/pkg"
      // Nested: "node_modules/a/node_modules/b"
      const name = extractPackageName(entryPath)
      if (!name || !entry.version) continue

      const key = `${name}@${entry.version}`

      // Only keep the first occurrence (shallowest in the tree)
      if (packages.has(key)) continue

      packages.set(key, {
        name,
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
        dependencies: entry.dependencies,
        optionalDependencies: entry.optionalDependencies,
        dev: entry.dev === true || entry.devOptional === true,
        optional: entry.optional === true || entry.devOptional === true,
        hasInstallScript: entry.hasInstallScript === true,
      })
    }

    return ok({ type: 'npm', packages })
  } catch (error) {
    return err({
      kind: 'lockfile-parse',
      message: error instanceof Error ? error.message : String(error),
      filePath,
    })
  }
}

/**
 * Extract the package name from a node_modules path.
 * Handles scoped packages and nested node_modules.
 */
function extractPackageName(entryPath: string): string | null {
  // Split on node_modules/ and take the last segment
  const parts = entryPath.split('node_modules/')
  const last = parts[parts.length - 1]
  if (!last) return null

  // Remove trailing slashes
  return last.replace(/\/$/, '')
}

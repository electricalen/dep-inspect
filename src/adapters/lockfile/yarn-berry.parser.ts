import * as fs from 'node:fs'

import { err, ok, type Result } from 'neverthrow'
import { parse as parseYaml } from 'yaml'

import type { LockfileParseError } from '../../shared/errors.js'
import type { FilePath } from '../../shared/types.js'
import type { LockfileData, LockfilePackage } from './lockfile.types.js'

interface YarnBerryEntry {
  version?: string
  resolution?: string
  checksum?: string
  dependencies?: Record<string, string>
  dependenciesMeta?: Record<string, { optional?: boolean }>
  languageName?: string
  linkType?: string
}

/**
 * Parse a yarn.lock (berry / v2+ YAML format) into normalized LockfileData.
 */
export function parseYarnBerryLockfile(
  filePath: FilePath,
): Result<LockfileData, LockfileParseError> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lock = parseYaml(content) as Record<string, YarnBerryEntry>

    const packages = new Map<string, LockfilePackage>()

    for (const [key, entry] of Object.entries(lock)) {
      // Skip metadata entry
      if (key === '__metadata') continue

      if (!entry.version) continue

      // Berry keys can be comma-separated for aliased packages
      // e.g., "lodash@npm:^4.17.21, lodash@npm:^4.17.20"
      const firstDescriptor = key.split(',')[0]?.trim()
      if (!firstDescriptor) continue

      const name = extractNameFromBerryDescriptor(firstDescriptor)
      if (!name) continue

      const pkgKey = `${name}@${entry.version}`
      if (packages.has(pkgKey)) continue

      packages.set(pkgKey, {
        name,
        version: entry.version,
        resolved: entry.resolution,
        integrity: entry.checksum,
        dependencies: entry.dependencies,
        dev: false, // Berry lockfile doesn't distinguish dev
        optional: false,
        hasInstallScript: false, // Not tracked in berry lockfile
      })
    }

    return ok({ type: 'yarn-berry', packages })
  } catch (error) {
    return err({
      kind: 'lockfile-parse',
      message: error instanceof Error ? error.message : String(error),
      filePath,
    })
  }
}

/**
 * Extract package name from a berry descriptor.
 * Format: "name@npm:range" or "@scope/name@npm:range"
 */
function extractNameFromBerryDescriptor(descriptor: string): string | null {
  // Handle scoped: "@scope/name@npm:range"
  if (descriptor.startsWith('@')) {
    const atIdx = descriptor.indexOf('@', 1)
    if (atIdx === -1) return null
    return descriptor.slice(0, atIdx)
  }

  // Unscoped: "name@npm:range"
  const atIdx = descriptor.indexOf('@')
  if (atIdx === -1) return null
  return descriptor.slice(0, atIdx)
}

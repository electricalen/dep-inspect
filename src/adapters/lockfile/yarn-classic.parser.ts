import * as fs from 'node:fs'

import { err, ok, type Result } from 'neverthrow'
import yarnLockfile from '@yarnpkg/lockfile'

const yarnParse = yarnLockfile.parse

import type { LockfileParseError } from '../../shared/errors.js'
import type { FilePath } from '../../shared/types.js'
import type { LockfileData, LockfilePackage } from './lockfile.types.js'

interface YarnClassicEntry {
  version: string
  resolved?: string
  integrity?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

/**
 * Parse a yarn.lock (v1 classic format) into normalized LockfileData.
 */
export function parseYarnClassicLockfile(
  filePath: FilePath,
): Result<LockfileData, LockfileParseError> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const result = yarnParse(content) as {
      type: string
      object: Record<string, YarnClassicEntry>
    }

    if (result.type !== 'success') {
      return err({
        kind: 'lockfile-parse',
        message: 'Failed to parse yarn.lock (classic format)',
        filePath,
      })
    }

    const packages = new Map<string, LockfilePackage>()

    for (const [descriptor, entry] of Object.entries(result.object)) {
      const name = extractNameFromDescriptor(descriptor)
      if (!name || !entry.version) continue

      const key = `${name}@${entry.version}`
      if (packages.has(key)) continue

      packages.set(key, {
        name,
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
        dependencies: entry.dependencies,
        optionalDependencies: entry.optionalDependencies,
        dev: false, // yarn v1 lockfile doesn't distinguish dev
        optional: false,
        hasInstallScript: false, // Not tracked in yarn v1 lockfile
      })
    }

    return ok({ type: 'yarn-classic', packages })
  } catch (error) {
    return err({
      kind: 'lockfile-parse',
      message: error instanceof Error ? error.message : String(error),
      filePath,
    })
  }
}

/**
 * Extract package name from a yarn classic descriptor.
 * Format: "name@range" or "@scope/name@range"
 */
function extractNameFromDescriptor(descriptor: string): string | null {
  // Handle scoped: "@scope/name@range"
  if (descriptor.startsWith('@')) {
    const atIdx = descriptor.indexOf('@', 1)
    if (atIdx === -1) return null
    return descriptor.slice(0, atIdx)
  }

  // Unscoped: "name@range"
  const atIdx = descriptor.indexOf('@')
  if (atIdx === -1) return null
  return descriptor.slice(0, atIdx)
}

import * as fs from 'node:fs'
import * as path from 'node:path'

import { err, ok, type Result } from 'neverthrow'

import type { FilesystemError } from '../../shared/errors.js'
import type { LockfileType } from './lockfile.types.js'

interface DetectedLockfile {
  readonly type: LockfileType
  readonly filePath: string
}

/**
 * Detect which lockfile exists in the given directory.
 * Checks in order of preference: npm, pnpm, yarn.
 */
export function detectLockfile(dir: string): Result<DetectedLockfile, FilesystemError> {
  const candidates: { filename: string; type: LockfileType | 'yarn' }[] = [
    { filename: 'package-lock.json', type: 'npm' },
    { filename: 'pnpm-lock.yaml', type: 'pnpm' },
    { filename: 'yarn.lock', type: 'yarn' },
  ]

  for (const { filename, type } of candidates) {
    const filePath = path.join(dir, filename)
    if (fs.existsSync(filePath)) {
      if (type === 'yarn') {
        const yarnType = detectYarnVersion(filePath)
        return ok({ type: yarnType, filePath })
      }
      return ok({ type, filePath })
    }
  }

  return err({
    kind: 'filesystem',
    message: 'No lockfile found. Expected package-lock.json, pnpm-lock.yaml, or yarn.lock',
    path: dir,
  })
}

/**
 * Detect whether a yarn.lock is v1 (classic) or v2+ (berry).
 * Berry uses standard YAML format; classic uses a custom format.
 */
function detectYarnVersion(filePath: string): 'yarn-classic' | 'yarn-berry' {
  const content = fs.readFileSync(filePath, 'utf-8')
  const firstLine = content.split('\n')[0] ?? ''

  // Yarn classic starts with "# yarn lockfile v1"
  if (firstLine.includes('yarn lockfile v1')) {
    return 'yarn-classic'
  }

  // Berry lockfiles have __metadata key
  if (content.includes('__metadata:')) {
    return 'yarn-berry'
  }

  // Default to classic if ambiguous
  return 'yarn-classic'
}

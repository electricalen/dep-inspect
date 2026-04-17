import { err, type Result } from 'neverthrow'

import type { LockfileParseError } from '../../shared/errors.js'
import type { FilePath } from '../../shared/types.js'
import type { LockfilePort } from '../../ports/lockfile.port.js'
import type { LockfileData } from './lockfile.types.js'
import { detectLockfile } from './lockfile.detect.js'
import { parseNpmLockfile } from './npm.parser.js'
import { parsePnpmLockfile } from './pnpm.parser.js'
import { parseYarnClassicLockfile } from './yarn-classic.parser.js'
import { parseYarnBerryLockfile } from './yarn-berry.parser.js'

/**
 * Create a lockfile adapter that auto-detects and parses any supported format.
 */
export function createLockfileAdapter(): LockfilePort {
  return {
    parse(dir: string): Result<LockfileData, LockfileParseError> {
      const detected = detectLockfile(dir)

      if (detected.isErr()) {
        return err({
          kind: 'lockfile-parse',
          message: detected.error.message,
          filePath: detected.error.path as FilePath,
        })
      }

      const { type, filePath } = detected.value
      const fp = filePath as FilePath

      switch (type) {
        case 'npm':
          return parseNpmLockfile(fp)
        case 'pnpm':
          return parsePnpmLockfile(fp)
        case 'yarn-classic':
          return parseYarnClassicLockfile(fp)
        case 'yarn-berry':
          return parseYarnBerryLockfile(fp)
      }
    },
  }
}

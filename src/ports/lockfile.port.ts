import type { Result } from 'neverthrow'

import type { LockfileParseError } from '../shared/errors.js'
import type { LockfileData } from '../adapters/lockfile/lockfile.types.js'

/**
 * Port interface for lockfile parsing.
 * Abstracts the specific lockfile format from the analysis layer.
 */
export interface LockfilePort {
  /** Parse the lockfile at the given directory, auto-detecting format. */
  parse(dir: string): Result<LockfileData, LockfileParseError>
}

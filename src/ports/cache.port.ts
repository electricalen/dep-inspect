import type { Result } from 'neverthrow'
import type { CacheError } from '../shared/errors.js'

/** Cache namespace for organizing entries by data source. */
export type CacheNamespace = 'registry' | 'github' | 'vulnerability' | 'downloads'

export interface CacheEntry<T> {
  readonly data: T
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly etag?: string | undefined
}

export interface CacheStats {
  readonly totalEntries: number
  readonly totalSizeBytes: number
  readonly entriesByNamespace: Record<CacheNamespace, number>
  readonly sizeByNamespace: Record<CacheNamespace, number>
  readonly oldestEntry: Date | null
  readonly newestEntry: Date | null
}

/**
 * Port interface for persistent caching of external data.
 * All operations are synchronous (backed by SQLite).
 */
export interface CachePort {
  /** Get a cached value. Returns `null` on cache miss or expired entry. */
  get<T>(namespace: CacheNamespace, key: string): Result<CacheEntry<T> | null, CacheError>

  /** Store a value. TTL is determined by namespace configuration. */
  set(
    namespace: CacheNamespace,
    key: string,
    data: unknown,
    etag?: string,
  ): Result<void, CacheError>

  /** Check if a non-expired entry exists. */
  has(namespace: CacheNamespace, key: string): Result<boolean, CacheError>

  /** Remove a specific entry. */
  delete(namespace: CacheNamespace, key: string): Result<void, CacheError>

  /** Remove all entries. */
  clear(): Result<void, CacheError>

  /** Remove expired entries and enforce max size via LRU eviction. */
  prune(): Result<{ removedCount: number; freedBytes: number }, CacheError>

  /** Get cache statistics. */
  stats(): Result<CacheStats, CacheError>

  /** Close the database connection. */
  close(): void
}

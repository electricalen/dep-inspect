import * as fs from 'node:fs'
import * as path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'

import Database from 'better-sqlite3'
import { err, ok, type Result } from 'neverthrow'

import type { CacheConfig } from '../../config/cache-config.js'
import type { CacheEntry, CacheNamespace, CachePort, CacheStats } from '../../ports/cache.port.js'
import type { CacheError } from '../../shared/errors.js'

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cache_entries (
    key           TEXT PRIMARY KEY,
    namespace     TEXT NOT NULL,
    data          BLOB NOT NULL,
    size_bytes    INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL,
    last_accessed INTEGER NOT NULL,
    etag          TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_namespace ON cache_entries(namespace);
  CREATE INDEX IF NOT EXISTS idx_expires ON cache_entries(expires_at);
  CREATE INDEX IF NOT EXISTS idx_lru ON cache_entries(last_accessed);
`

function wrapError(error: unknown): CacheError {
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'cache', message }
}

/**
 * SQLite-backed cache adapter with WAL mode, gzip compression,
 * TTL expiry, and LRU eviction.
 */
export function createSqliteCache(config: CacheConfig): CachePort {
  // Ensure cache directory exists
  fs.mkdirSync(config.directory, { recursive: true })

  const dbPath = path.join(config.directory, 'cache.sqlite3')
  const db = new Database(dbPath)

  // Enable WAL mode for concurrent access and set busy timeout
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.exec(SCHEMA_SQL)

  // Prepared statements for performance
  const getStmt = db.prepare<
    [string],
    {
      data: Buffer
      created_at: number
      expires_at: number
      etag: string | null
    }
  >('SELECT data, created_at, expires_at, etag FROM cache_entries WHERE key = ?')

  const updateAccessStmt = db.prepare<[number, string]>(
    'UPDATE cache_entries SET last_accessed = ? WHERE key = ?',
  )

  const upsertStmt = db.prepare<
    [string, string, Buffer, number, number, number, number, string | null]
  >(
    `INSERT OR REPLACE INTO cache_entries (key, namespace, data, size_bytes, created_at, expires_at, last_accessed, etag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const deleteStmt = db.prepare<[string]>('DELETE FROM cache_entries WHERE key = ?')
  const deleteExpiredStmt = db.prepare<[number]>('DELETE FROM cache_entries WHERE expires_at < ?')
  const clearStmt = db.prepare('DELETE FROM cache_entries')
  const hasStmt = db.prepare<[string, number]>(
    'SELECT 1 FROM cache_entries WHERE key = ? AND expires_at > ?',
  )

  const totalSizeStmt = db.prepare<[], { total: number }>(
    'SELECT COALESCE(SUM(size_bytes), 0) as total FROM cache_entries',
  )

  const statsStmt = db.prepare<
    [],
    {
      namespace: string
      entry_count: number
      total_size: number
    }
  >(
    `SELECT namespace, COUNT(*) as entry_count, COALESCE(SUM(size_bytes), 0) as total_size
     FROM cache_entries GROUP BY namespace`,
  )

  const countStmt = db.prepare<[], { cnt: number }>('SELECT COUNT(*) as cnt FROM cache_entries')
  const totalSizeAllStmt = db.prepare<[], { total: number }>(
    'SELECT COALESCE(SUM(size_bytes), 0) as total FROM cache_entries',
  )
  const oldestStmt = db.prepare<[], { ts: number }>(
    'SELECT MIN(created_at) as ts FROM cache_entries',
  )
  const newestStmt = db.prepare<[], { ts: number }>(
    'SELECT MAX(created_at) as ts FROM cache_entries',
  )

  const evictLruStmt = db.prepare<[number]>(
    `DELETE FROM cache_entries WHERE key IN (
       SELECT key FROM cache_entries ORDER BY last_accessed ASC LIMIT ?
     )`,
  )

  function compositeKey(namespace: CacheNamespace, key: string): string {
    return `${namespace}:${key}`
  }

  const port: CachePort = {
    get<T>(namespace: CacheNamespace, key: string): Result<CacheEntry<T> | null, CacheError> {
      try {
        const ck = compositeKey(namespace, key)
        const row = getStmt.get(ck)

        if (!row) return ok(null)

        const now = Date.now()
        if (row.expires_at < now) {
          deleteStmt.run(ck)
          return ok(null)
        }

        updateAccessStmt.run(now, ck)

        const decompressed = gunzipSync(row.data).toString('utf-8')
        const data = JSON.parse(decompressed) as T

        return ok({
          data,
          createdAt: new Date(row.created_at),
          expiresAt: new Date(row.expires_at),
          etag: row.etag ?? undefined,
        })
      } catch (error) {
        return err(wrapError(error))
      }
    },

    set(
      namespace: CacheNamespace,
      key: string,
      data: unknown,
      etag?: string,
    ): Result<void, CacheError> {
      try {
        const ck = compositeKey(namespace, key)
        const json = JSON.stringify(data)
        const compressed = gzipSync(Buffer.from(json, 'utf-8'))
        const now = Date.now()
        const ttl = config.maxAge[namespace]
        const expiresAt = now + ttl

        upsertStmt.run(ck, namespace, compressed, json.length, now, expiresAt, now, etag ?? null)

        // Check if we need to prune
        const sizeRow = totalSizeStmt.get()
        if (sizeRow && sizeRow.total > config.maxSizeBytes) {
          port.prune()
        }

        return ok(undefined)
      } catch (error) {
        return err(wrapError(error))
      }
    },

    has(namespace: CacheNamespace, key: string): Result<boolean, CacheError> {
      try {
        const ck = compositeKey(namespace, key)
        const row = hasStmt.get(ck, Date.now())
        return ok(row !== undefined)
      } catch (error) {
        return err(wrapError(error))
      }
    },

    delete(namespace: CacheNamespace, key: string): Result<void, CacheError> {
      try {
        deleteStmt.run(compositeKey(namespace, key))
        return ok(undefined)
      } catch (error) {
        return err(wrapError(error))
      }
    },

    clear(): Result<void, CacheError> {
      try {
        clearStmt.run()
        return ok(undefined)
      } catch (error) {
        return err(wrapError(error))
      }
    },

    prune(): Result<{ removedCount: number; freedBytes: number }, CacheError> {
      try {
        const sizeBefore = totalSizeAllStmt.get()?.total ?? 0
        const countBefore = countStmt.get()?.cnt ?? 0

        // Phase 1: Delete expired entries
        deleteExpiredStmt.run(Date.now())

        // Phase 2: LRU eviction if still over budget
        let currentSize = totalSizeAllStmt.get()?.total ?? 0
        while (currentSize > config.maxSizeBytes) {
          evictLruStmt.run(10) // Evict 10 at a time
          currentSize = totalSizeAllStmt.get()?.total ?? 0
        }

        const countAfter = countStmt.get()?.cnt ?? 0
        const sizeAfter = totalSizeAllStmt.get()?.total ?? 0

        return ok({
          removedCount: countBefore - countAfter,
          freedBytes: sizeBefore - sizeAfter,
        })
      } catch (error) {
        return err(wrapError(error))
      }
    },

    stats(): Result<CacheStats, CacheError> {
      try {
        const rows = statsStmt.all()
        const count = countStmt.get()?.cnt ?? 0
        const totalSize = totalSizeAllStmt.get()?.total ?? 0
        const oldest = oldestStmt.get()?.ts
        const newest = newestStmt.get()?.ts

        const entriesByNamespace: Record<CacheNamespace, number> = {
          registry: 0,
          github: 0,
          vulnerability: 0,
          downloads: 0,
        }
        const sizeByNamespace: Record<CacheNamespace, number> = {
          registry: 0,
          github: 0,
          vulnerability: 0,
          downloads: 0,
        }

        for (const row of rows) {
          const ns = row.namespace as CacheNamespace
          entriesByNamespace[ns] = row.entry_count
          sizeByNamespace[ns] = row.total_size
        }

        return ok({
          totalEntries: count,
          totalSizeBytes: totalSize,
          entriesByNamespace,
          sizeByNamespace,
          oldestEntry: oldest ? new Date(oldest) : null,
          newestEntry: newest ? new Date(newest) : null,
        })
      } catch (error) {
        return err(wrapError(error))
      }
    },

    close(): void {
      db.close()
    },
  }

  return port
}

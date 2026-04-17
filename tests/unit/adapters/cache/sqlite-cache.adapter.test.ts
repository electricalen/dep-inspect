import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createSqliteCache } from '../../../../src/adapters/cache/sqlite-cache.adapter.js'
import type { CacheConfig } from '../../../../src/config/cache-config.js'
import type { CachePort } from '../../../../src/ports/cache.port.js'

function createTestConfig(dir: string): CacheConfig {
  return {
    directory: dir,
    maxAge: {
      registry: 60_000, // 1 minute
      github: 60_000,
      vulnerability: 60_000,
      downloads: 60_000,
    },
    maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  }
}

describe('SqliteCacheAdapter', () => {
  let tmpDir: string
  let cache: CachePort

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-inspect-test-'))
    cache = createSqliteCache(createTestConfig(tmpDir))
  })

  afterEach(() => {
    cache.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null on cache miss', () => {
    const result = cache.get('registry', 'nonexistent')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('stores and retrieves values', () => {
    const data = { name: 'lodash', version: '4.17.21' }
    cache.set('registry', 'lodash', data)

    const result = cache.get<typeof data>('registry', 'lodash')
    expect(result.isOk()).toBe(true)
    const entry = result._unsafeUnwrap()
    expect(entry).not.toBeNull()
    expect(entry!.data).toEqual(data)
  })

  it('stores etag alongside data', () => {
    cache.set('registry', 'react', { name: 'react' }, 'W/"abc123"')

    const result = cache.get<{ name: string }>('registry', 'react')
    const entry = result._unsafeUnwrap()
    expect(entry?.etag).toBe('W/"abc123"')
  })

  it('returns null for expired entries', () => {
    const config = createTestConfig(tmpDir)
    cache.close()

    // Create cache with 1ms TTL
    const shortLivedConfig: CacheConfig = {
      ...config,
      maxAge: { registry: 1, github: 1, vulnerability: 1, downloads: 1 },
    }
    cache = createSqliteCache(shortLivedConfig)
    cache.set('registry', 'expired-pkg', { name: 'test' })

    // Wait for expiry
    const start = Date.now()
    while (Date.now() - start < 5) {
      // busy wait 5ms
    }

    const result = cache.get('registry', 'expired-pkg')
    expect(result._unsafeUnwrap()).toBeNull()
  })

  it('reports has correctly', () => {
    cache.set('registry', 'exists', { data: true })

    expect(cache.has('registry', 'exists')._unsafeUnwrap()).toBe(true)
    expect(cache.has('registry', 'missing')._unsafeUnwrap()).toBe(false)
  })

  it('deletes entries', () => {
    cache.set('registry', 'to-delete', { data: true })
    cache.delete('registry', 'to-delete')

    expect(cache.has('registry', 'to-delete')._unsafeUnwrap()).toBe(false)
  })

  it('clears all entries', () => {
    cache.set('registry', 'a', { data: 1 })
    cache.set('github', 'b', { data: 2 })
    cache.clear()

    const stats = cache.stats()._unsafeUnwrap()
    expect(stats.totalEntries).toBe(0)
  })

  it('reports stats correctly', () => {
    cache.set('registry', 'pkg1', { name: 'a' })
    cache.set('registry', 'pkg2', { name: 'b' })
    cache.set('github', 'repo1', { stars: 100 })

    const stats = cache.stats()._unsafeUnwrap()
    expect(stats.totalEntries).toBe(3)
    expect(stats.entriesByNamespace.registry).toBe(2)
    expect(stats.entriesByNamespace.github).toBe(1)
    expect(stats.entriesByNamespace.vulnerability).toBe(0)
    expect(stats.oldestEntry).toBeInstanceOf(Date)
    expect(stats.newestEntry).toBeInstanceOf(Date)
  })

  it('separates entries by namespace', () => {
    cache.set('registry', 'lodash', { source: 'registry' })
    cache.set('github', 'lodash', { source: 'github' })

    const registryEntry = cache.get<{ source: string }>('registry', 'lodash')._unsafeUnwrap()
    const githubEntry = cache.get<{ source: string }>('github', 'lodash')._unsafeUnwrap()

    expect(registryEntry?.data.source).toBe('registry')
    expect(githubEntry?.data.source).toBe('github')
  })

  it('overwrites existing entries on set', () => {
    cache.set('registry', 'pkg', { version: 1 })
    cache.set('registry', 'pkg', { version: 2 })

    const entry = cache.get<{ version: number }>('registry', 'pkg')._unsafeUnwrap()
    expect(entry?.data.version).toBe(2)
  })

  it('prunes expired entries', () => {
    cache.close()

    const config: CacheConfig = {
      ...createTestConfig(tmpDir),
      maxAge: { registry: 1, github: 1, vulnerability: 1, downloads: 1 },
    }
    cache = createSqliteCache(config)

    cache.set('registry', 'a', { data: 1 })
    cache.set('registry', 'b', { data: 2 })

    // Wait for expiry
    const start = Date.now()
    while (Date.now() - start < 5) {
      // busy wait
    }

    const result = cache.prune()._unsafeUnwrap()
    expect(result.removedCount).toBe(2)
    expect(cache.stats()._unsafeUnwrap().totalEntries).toBe(0)
  })
})

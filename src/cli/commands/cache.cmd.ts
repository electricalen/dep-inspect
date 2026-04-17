import { createSqliteCache } from '../../adapters/cache/sqlite-cache.adapter.js'
import { buildCacheConfig } from '../../config/cache-config.js'
import { DEFAULT_POLICY } from '../../config/config.defaults.js'
import { loadPolicyConfig } from '../../config/config.loader.js'
import type { CacheConfigRaw } from '../../core/policy/policy.types.js'
import { logger } from '../../shared/logger.js'

/**
 * `dep-inspect cache clear` — delete all cached data.
 */
export function cacheClearCommand(): void {
  const cache = openCache()
  const result = cache.clear()
  cache.close()

  if (result.isOk()) {
    logger.info('Cache cleared successfully')
  } else {
    logger.error(`Failed to clear cache: ${result.error.message}`)
    process.exitCode = 1
  }
}

/**
 * `dep-inspect cache stats` — show cache statistics.
 */
export function cacheStatsCommand(): void {
  const cache = openCache()
  const result = cache.stats()
  cache.close()

  if (result.isErr()) {
    logger.error(`Failed to read cache stats: ${result.error.message}`)
    process.exitCode = 1
    return
  }

  const stats = result.value

  console.log('')
  console.log(`Cache directory: ${getCacheDir()}`)
  console.log(`Total entries:   ${stats.totalEntries}`)
  console.log(`Total size:      ${formatBytes(stats.totalSizeBytes)}`)
  console.log('')
  console.log('By namespace:')

  for (const [ns, entries] of Object.entries(stats.entriesByNamespace)) {
    const size = stats.sizeByNamespace[ns as keyof typeof stats.sizeByNamespace]
    console.log(
      `  ${ns.padEnd(16)} ${String(entries).padStart(5)} entries  ${formatBytes(size).padStart(10)}`,
    )
  }
  console.log('')
}

function resolveConfig() {
  const policyResult = loadPolicyConfig()
  const policy = policyResult.isOk() ? policyResult.value : DEFAULT_POLICY
  return buildCacheConfig(policy.cache ? policyCacheToRaw(policy.cache) : undefined)
}

function openCache() {
  return createSqliteCache(resolveConfig())
}

function getCacheDir(): string {
  return resolveConfig().directory
}

function policyCacheToRaw(
  raw: CacheConfigRaw | undefined,
): { maxAge?: Record<string, string>; maxSize?: string; directory?: string } | undefined {
  if (!raw) return undefined
  const result: Record<string, unknown> = {}

  if (raw.maxAge) {
    const maxAge: Record<string, string> = {}
    for (const [key, val] of Object.entries(raw.maxAge)) {
      if (val) maxAge[key] = val
    }
    if (Object.keys(maxAge).length > 0) result['maxAge'] = maxAge
  }

  if (raw.maxSize) result['maxSize'] = raw.maxSize
  if (raw.directory) result['directory'] = raw.directory

  return result as { maxAge?: Record<string, string>; maxSize?: string; directory?: string }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

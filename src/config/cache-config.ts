import * as os from 'node:os'
import * as path from 'node:path'

import type { CacheNamespace } from '../ports/cache.port.js'

export interface CacheConfig {
  readonly directory: string
  readonly maxAge: Record<CacheNamespace, number>
  readonly maxSizeBytes: number
}

/** Default TTLs in milliseconds. */
const DEFAULT_MAX_AGE: Record<CacheNamespace, number> = {
  registry: 60 * 60 * 1000, // 1 hour
  github: 6 * 60 * 60 * 1000, // 6 hours
  vulnerability: 30 * 60 * 1000, // 30 minutes
  downloads: 24 * 60 * 60 * 1000, // 24 hours
}

const DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

/**
 * Parse a duration string like "1h", "30m", "24h" into milliseconds.
 * Supports: m (minutes), h (hours), d (days).
 */
export function parseDuration(input: string): number {
  const match = /^(\d+)(m|h|d)$/i.exec(input.trim())
  if (!match) {
    throw new Error(`Invalid duration format: "${input}". Use "30m", "1h", or "7d".`)
  }

  const value = parseInt(match[1] ?? '0', 10)
  const unit = match[2]?.toLowerCase()
  const multipliers: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 }

  return value * (multipliers[unit ?? 'm'] ?? 60_000)
}

/**
 * Parse a size string like "100MB", "1GB" into bytes.
 * Supports: KB, MB, GB.
 */
export function parseSize(input: string): number {
  const match = /^(\d+)\s*(KB|MB|GB)$/i.exec(input.trim())
  if (!match) {
    throw new Error(`Invalid size format: "${input}". Use "100MB", "1GB", etc.`)
  }

  const value = parseInt(match[1] ?? '0', 10)
  const unit = match[2]?.toUpperCase()
  const multipliers: Record<string, number> = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  }

  return value * (multipliers[unit ?? 'MB'] ?? 1024 * 1024)
}

/** Resolve the cache directory path, respecting XDG conventions. */
export function resolveCacheDirectory(configDir?: string): string {
  if (configDir) {
    return configDir.startsWith('~') ? path.join(os.homedir(), configDir.slice(1)) : configDir
  }

  const xdg = process.env['XDG_CACHE_HOME']
  if (xdg) {
    return path.join(xdg, 'dep-inspect')
  }

  return path.join(os.homedir(), '.dep-inspect', 'cache')
}

/** Build a CacheConfig from raw config values with defaults. */
export function buildCacheConfig(raw?: {
  maxAge?: Partial<Record<CacheNamespace, string>>
  maxSize?: string
  directory?: string
}): CacheConfig {
  const maxAge = { ...DEFAULT_MAX_AGE }

  if (raw?.maxAge) {
    for (const [ns, duration] of Object.entries(raw.maxAge)) {
      if (duration) {
        maxAge[ns as CacheNamespace] = parseDuration(duration)
      }
    }
  }

  return {
    directory: resolveCacheDirectory(raw?.directory),
    maxAge,
    maxSizeBytes: raw?.maxSize ? parseSize(raw.maxSize) : DEFAULT_MAX_SIZE_BYTES,
  }
}

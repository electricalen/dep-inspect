import { ResultAsync } from 'neverthrow'

import type { RegistryError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import type { CachePort } from '../../ports/cache.port.js'
import type { DownloadCount, PackageMetadata, RegistryPort } from '../../ports/registry.port.js'

/** JSON.parse turns Dates into strings — restore contract expected by detectors. */
function revivePackageMetadata(raw: PackageMetadata): PackageMetadata {
  const publishedAt =
    raw.publishedAt instanceof Date ? raw.publishedAt : new Date(String(raw.publishedAt))
  const createdAt = raw.createdAt instanceof Date ? raw.createdAt : new Date(String(raw.createdAt))
  return { ...raw, publishedAt, createdAt }
}

/**
 * Cache decorator for the registry port.
 * Checks cache before calling the inner adapter; stores results on cache miss.
 */
export function withRegistryCache(inner: RegistryPort, cache: CachePort): RegistryPort {
  return {
    getPackageMetadata(
      name: string,
      version?: string,
    ): ResultAsync<PackageMetadata, RegistryError> {
      const cacheKey = version ? `${name}@${version}` : name

      return ResultAsync.fromPromise(
        (async () => {
          const cached = cache.get<PackageMetadata>('registry', cacheKey)
          if (cached.isOk() && cached.value !== null) {
            logger.debug(`Cache hit: registry:${cacheKey}`)
            return revivePackageMetadata(cached.value.data)
          }

          const result = await inner.getPackageMetadata(name, version)
          if (result.isOk()) {
            cache.set('registry', cacheKey, result.value)
          }

          return result.match(
            (data) => data,
            (error) => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw error
            },
          )
        })(),
        (error): RegistryError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as RegistryError
          }
          return { kind: 'registry', message: String(error), packageName: name }
        },
      )
    },

    getDownloadCounts(name: string): ResultAsync<DownloadCount, RegistryError> {
      return ResultAsync.fromPromise(
        (async () => {
          const cached = cache.get<DownloadCount>('downloads', name)
          if (cached.isOk() && cached.value !== null) {
            logger.debug(`Cache hit: downloads:${name}`)
            return cached.value.data
          }

          const result = await inner.getDownloadCounts(name)
          if (result.isOk()) {
            cache.set('downloads', name, result.value)
          }

          return result.match(
            (data) => data,
            (error) => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw error
            },
          )
        })(),
        (error): RegistryError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as RegistryError
          }
          return { kind: 'registry', message: String(error), packageName: name }
        },
      )
    },
  }
}

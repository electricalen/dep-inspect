import { ResultAsync } from 'neverthrow'

import type { RegistryError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'
import type {
  DownloadCount,
  MaintainerInfo,
  PackageMetadata,
  RegistryPort,
  RepositoryInfo,
} from '../ports/registry.port.js'

const REGISTRY_BASE = 'https://registry.npmjs.org'
const DOWNLOADS_BASE = 'https://api.npmjs.org/downloads/point/last-week'

/**
 * Raw npm registry packument shape (abbreviated).
 */
interface RawPackument {
  name: string
  description?: string
  'dist-tags'?: Record<string, string>
  time?: Record<string, string>
  versions?: Record<string, RawVersionEntry>
  maintainers?: { name: string; email?: string }[]
}

interface RawVersionEntry {
  name: string
  version: string
  description?: string
  license?: string | { type?: string }
  deprecated?: string
  repository?: string | { type?: string; url?: string }
  scripts?: Record<string, string>
  maintainers?: { name: string; email?: string }[]
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function parseRepository(raw: unknown): RepositoryInfo | undefined {
  if (!raw) return undefined

  if (typeof raw === 'string') {
    return { url: raw }
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    if (typeof obj['url'] === 'string') {
      return {
        type: typeof obj['type'] === 'string' ? obj['type'] : undefined,
        url: obj['url'],
      }
    }
  }

  return undefined
}

function parseLicense(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    if (typeof obj['type'] === 'string') return obj['type']
  }
  return undefined
}

function parseMaintainers(raw: unknown): MaintainerInfo[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (m): m is { name: string; email?: string } =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as Record<string, unknown>)['name'] === 'string',
    )
    .map((m) => ({
      name: m.name,
      email: m.email,
    }))
}

async function fetchJson(
  url: string,
): Promise<{ data: unknown; etag?: string | undefined } | { error: RegistryError }> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      return {
        error: {
          kind: 'registry',
          message: `HTTP ${response.status}: ${response.statusText}`,
          statusCode: response.status,
        },
      }
    }

    const data: unknown = await response.json()
    const etag = response.headers.get('etag') ?? undefined
    return { data, etag }
  } catch (error) {
    return {
      error: {
        kind: 'registry',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

/**
 * Create an npm registry adapter.
 */
export function createNpmRegistryAdapter(): RegistryPort {
  // In-memory cache for packuments (one per package name per CLI invocation)
  const packumentCache = new Map<string, RawPackument>()

  async function fetchPackument(name: string): Promise<RawPackument | RegistryError> {
    const cached = packumentCache.get(name)
    if (cached) return cached

    logger.debug(`Fetching packument for ${name}`)
    const result = await fetchJson(`${REGISTRY_BASE}/${encodeURIComponent(name)}`)

    if ('error' in result) {
      return { ...result.error, packageName: name }
    }

    const data = result.data as RawPackument
    packumentCache.set(name, data)
    return data
  }

  return {
    getPackageMetadata(
      name: string,
      version?: string,
    ): ResultAsync<PackageMetadata, RegistryError> {
      return ResultAsync.fromPromise(
        (async () => {
          const packument = await fetchPackument(name)
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          if ('kind' in packument) throw packument

          const latestTag = packument['dist-tags']?.['latest'] ?? ''
          const targetVersion = version ?? latestTag
          const versionEntry = packument.versions?.[targetVersion]

          if (!versionEntry) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw {
              kind: 'registry' as const,
              message: `Version ${targetVersion} not found for ${name}`,
              packageName: name,
            }
          }

          const timeMap = packument.time ?? {}
          const publishedAt = timeMap[targetVersion] ? new Date(timeMap[targetVersion]) : new Date()
          const createdAt = timeMap['created'] ? new Date(timeMap['created']) : publishedAt

          return {
            name: versionEntry.name,
            description: versionEntry.description,
            license: parseLicense(versionEntry.license),
            version: versionEntry.version,
            deprecated: versionEntry.deprecated,
            repository: parseRepository(versionEntry.repository),
            maintainers: parseMaintainers(versionEntry.maintainers ?? packument.maintainers),
            publishedAt,
            createdAt,
            scripts: versionEntry.scripts,
            dependencies: versionEntry.dependencies,
            optionalDependencies: versionEntry.optionalDependencies,
            latestVersion: latestTag,
            allVersions: Object.keys(packument.versions ?? {}),
          } satisfies PackageMetadata
        })(),
        (error): RegistryError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as RegistryError
          }
          return {
            kind: 'registry',
            message: error instanceof Error ? error.message : String(error),
            packageName: name,
          }
        },
      )
    },

    getDownloadCounts(name: string): ResultAsync<DownloadCount, RegistryError> {
      return ResultAsync.fromPromise(
        (async () => {
          const result = await fetchJson(`${DOWNLOADS_BASE}/${encodeURIComponent(name)}`)

          // eslint-disable-next-line @typescript-eslint/only-throw-error
          if ('error' in result) throw result.error

          const data = result.data as { downloads?: number }
          return { weekly: data.downloads ?? 0 }
        })(),
        (error): RegistryError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as RegistryError
          }
          return {
            kind: 'registry',
            message: error instanceof Error ? error.message : String(error),
            packageName: name,
          }
        },
      )
    },
  }
}

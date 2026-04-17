import { withGitHubCache } from '../../adapters/cache/cached-github.adapter.js'
import { withRegistryCache } from '../../adapters/cache/cached-registry.adapter.js'
import { withVulnerabilityCache } from '../../adapters/cache/cached-vulnerability.adapter.js'
import { createSqliteCache } from '../../adapters/cache/sqlite-cache.adapter.js'
import { createGitHubAdapter } from '../../adapters/github/github.adapter.js'
import { createLockfileAdapter } from '../../adapters/lockfile/lockfile.adapter.js'
import { createNpmRegistryAdapter } from '../../adapters/npm-registry.adapter.js'
import { createOsvAdapter } from '../../adapters/osv.adapter.js'
import { buildCacheConfig } from '../../config/cache-config.js'
import { DEFAULT_POLICY, STRICT_POLICY_OVERRIDES } from '../../config/config.defaults.js'
import { loadPolicyConfig } from '../../config/config.loader.js'
import type { PolicyConfig } from '../../core/policy/policy.types.js'
import type { CachePort } from '../../ports/cache.port.js'
import type { GitHubPort } from '../../ports/github.port.js'
import type { LockfilePort } from '../../ports/lockfile.port.js'
import type { RegistryPort } from '../../ports/registry.port.js'
import type { VulnerabilityPort } from '../../ports/vulnerability.port.js'
import { formatError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'

interface AdapterOptions {
  /** Whether to include GitHub data. */
  readonly github: boolean
  /** Whether to enable heuristic-heavy checks. */
  readonly strict?: boolean
}

interface Adapters {
  readonly registry: RegistryPort
  readonly vulnerability: VulnerabilityPort
  readonly github: GitHubPort | undefined
  readonly lockfile: LockfilePort
  readonly policy: PolicyConfig
  readonly cache: CachePort
  /** Call this to close the cache database. */
  readonly cleanup: () => void
}

/**
 * Composition root: wire up all adapters with caching.
 * Loads policy config, creates cache, wraps adapters with cache decorators.
 */
export function createAdapters(opts: AdapterOptions): Adapters {
  // Load policy
  const policyResult = loadPolicyConfig()
  if (policyResult.isErr()) {
    logger.warn(`Policy config error: ${formatError(policyResult.error)}. Using defaults.`)
  }
  const loadedPolicy = policyResult.isOk() ? policyResult.value : DEFAULT_POLICY
  const policy = opts.strict ? applyStrictPolicy(loadedPolicy) : loadedPolicy

  // Create cache
  const cacheConfig = buildCacheConfig(policyCacheToRaw(policy))
  const cache = createSqliteCache(cacheConfig)

  // Create adapters with cache wrapping
  const registry = withRegistryCache(createNpmRegistryAdapter(), cache)
  const vulnerability = withVulnerabilityCache(createOsvAdapter(), cache)

  let github: GitHubPort | undefined
  if (opts.github) {
    github = withGitHubCache(createGitHubAdapter(), cache)
  }

  const lockfile = createLockfileAdapter()

  return {
    registry,
    vulnerability,
    github,
    lockfile,
    policy,
    cache,
    cleanup: () => {
      cache.close()
    },
  }
}

function applyStrictPolicy(policy: PolicyConfig): PolicyConfig {
  return {
    ...policy,
    severity: {
      ...policy.severity,
      ...STRICT_POLICY_OVERRIDES,
    },
  }
}

/**
 * Convert policy cache config to the shape expected by buildCacheConfig.
 * Handles exactOptionalPropertyTypes by only including defined fields.
 */
function policyCacheToRaw(
  policy: PolicyConfig,
): { maxAge?: Record<string, string>; maxSize?: string; directory?: string } | undefined {
  if (!policy.cache) return undefined

  const raw: { maxAge?: Record<string, string>; maxSize?: string; directory?: string } = {}

  if (policy.cache.maxAge) {
    const maxAge: Record<string, string> = {}
    for (const [key, val] of Object.entries(policy.cache.maxAge)) {
      if (val) maxAge[key] = val
    }
    if (Object.keys(maxAge).length > 0) raw.maxAge = maxAge
  }

  if (policy.cache.maxSize) raw.maxSize = policy.cache.maxSize
  if (policy.cache.directory) raw.directory = policy.cache.directory

  return raw
}

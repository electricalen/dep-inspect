import { ResultAsync } from 'neverthrow'

import type { GitHubError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import type { CachePort } from '../../ports/cache.port.js'
import type { GitHubPort, GitHubRepoData } from '../../ports/github.port.js'

/** JSON.parse deserializes dates as strings — restore type expected by formatters/detectors. */
function reviveGitHubRepoData(raw: GitHubRepoData): GitHubRepoData {
  const lastCommitDate =
    raw.lastCommitDate instanceof Date ? raw.lastCommitDate : new Date(String(raw.lastCommitDate))
  return { ...raw, lastCommitDate }
}

/**
 * Cache decorator for the GitHub port.
 */
export function withGitHubCache(inner: GitHubPort, cache: CachePort): GitHubPort {
  return {
    fetchRepo(owner: string, repo: string): ResultAsync<GitHubRepoData, GitHubError> {
      const cacheKey = `${owner}/${repo}`.toLowerCase()

      return ResultAsync.fromPromise(
        (async () => {
          const cached = cache.get<GitHubRepoData>('github', cacheKey)
          if (cached.isOk() && cached.value !== null) {
            logger.debug(`Cache hit: github:${cacheKey}`)
            return reviveGitHubRepoData(cached.value.data)
          }

          const result = await inner.fetchRepo(owner, repo)
          if (result.isOk()) {
            cache.set('github', cacheKey, result.value)
          }

          return result.match(
            (data) => data,
            (error) => {
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw error
            },
          )
        })(),
        (error): GitHubError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as GitHubError
          }
          return { kind: 'github', message: String(error), owner, repo }
        },
      )
    },
  }
}

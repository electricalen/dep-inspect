import { ResultAsync } from 'neverthrow'

import type { GitHubError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import type { GitHubPort, GitHubRepoData } from '../../ports/github.port.js'

const GITHUB_API = 'https://api.github.com'

interface GitHubRepoResponse {
  stargazers_count?: number
  forks_count?: number
  open_issues_count?: number
  archived?: boolean
  pushed_at?: string
}

/**
 * Create a GitHub REST API adapter.
 * Works without authentication (60 req/hr) or with token (5,000 req/hr).
 */
export function createGitHubRestAdapter(token?: string): GitHubPort {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'dep-inspect',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  async function fetchGitHub<T>(path: string): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, { headers })

    if (response.status === 404) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw { kind: 'github' as const, message: 'Repository not found', statusCode: 404 }
    }

    if (response.status === 403 || response.status === 429) {
      const resetHeader = response.headers.get('x-ratelimit-reset')
      const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : undefined
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw {
        kind: 'github' as const,
        message: `Rate limited${resetAt ? ` until ${resetAt.toISOString()}` : ''}`,
        statusCode: response.status,
      }
    }

    if (!response.ok) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw {
        kind: 'github' as const,
        message: `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      }
    }

    return (await response.json()) as T
  }

  function parseContributorCount(linkHeader: string | null): number {
    if (!linkHeader) return 1

    // Parse "last" page from Link header: <url?page=N>; rel="last"
    const lastMatch = /[?&]page=(\d+)>;\s*rel="last"/.exec(linkHeader)
    if (lastMatch?.[1]) {
      return parseInt(lastMatch[1], 10)
    }

    return 1
  }

  return {
    fetchRepo(owner: string, repo: string): ResultAsync<GitHubRepoData, GitHubError> {
      return ResultAsync.fromPromise(
        (async () => {
          logger.debug(`Fetching GitHub data for ${owner}/${repo}`)

          // Fetch repo data
          const repoData = await fetchGitHub<GitHubRepoResponse>(`/repos/${owner}/${repo}`)

          // Fetch contributor count (parse Link header for total)
          let contributorCount = 0
          try {
            const contribResponse = await fetch(
              `${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
              { headers },
            )
            if (contribResponse.ok) {
              contributorCount = parseContributorCount(contribResponse.headers.get('link'))
            }
          } catch {
            // Non-critical, default to 0
          }

          // Fetch commit count for last 12 months
          let commitsLast12Months = 0
          try {
            const since = new Date()
            since.setFullYear(since.getFullYear() - 1)
            const commitResponse = await fetch(
              `${GITHUB_API}/repos/${owner}/${repo}/commits?since=${since.toISOString()}&per_page=1`,
              { headers },
            )
            if (commitResponse.ok) {
              commitsLast12Months = parseContributorCount(commitResponse.headers.get('link'))
            }
          } catch {
            // Non-critical
          }

          // Fetch closed issues count for issue close ratio
          let closedIssues = 0
          try {
            const closedResponse = await fetch(
              `${GITHUB_API}/search/issues?q=repo:${owner}/${repo}+type:issue+state:closed&per_page=1`,
              { headers },
            )
            if (closedResponse.ok) {
              const closedData = (await closedResponse.json()) as { total_count?: number }
              closedIssues = closedData.total_count ?? 0
            }
          } catch {
            // Non-critical
          }

          return {
            owner,
            repo,
            stars: repoData.stargazers_count ?? 0,
            forks: repoData.forks_count ?? 0,
            contributorCount,
            lastCommitDate: repoData.pushed_at ? new Date(repoData.pushed_at) : new Date(),
            openIssues: repoData.open_issues_count ?? 0,
            closedIssues,
            isArchived: repoData.archived === true,
            commitsLast12Months,
          } satisfies GitHubRepoData
        })(),
        (error): GitHubError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as GitHubError
          }
          return {
            kind: 'github',
            message: error instanceof Error ? error.message : String(error),
            owner,
            repo,
          }
        },
      )
    },
  }
}

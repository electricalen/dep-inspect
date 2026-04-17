import type { ResultAsync } from 'neverthrow'

import type { GitHubError } from '../shared/errors.js'

/** GitHub repository health data. */
export interface GitHubRepoData {
  readonly owner: string
  readonly repo: string
  readonly stars: number
  readonly forks: number
  readonly contributorCount: number
  readonly lastCommitDate: Date
  readonly openIssues: number
  readonly closedIssues: number
  readonly isArchived: boolean
  readonly commitsLast12Months: number
}

/**
 * Port interface for GitHub repository data.
 */
export interface GitHubPort {
  /** Fetch health data for a single repository. */
  fetchRepo(owner: string, repo: string): ResultAsync<GitHubRepoData, GitHubError>
}

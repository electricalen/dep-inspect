import type { GitHubPort } from '../../ports/github.port.js'
import { createGitHubRestAdapter } from './github-rest.adapter.js'

/**
 * Create a GitHub adapter, selecting the best strategy based on available credentials.
 *
 * - With GITHUB_TOKEN: Uses REST API with authentication (5,000 req/hr)
 * - Without token: Uses REST API without authentication (60 req/hr)
 *
 * Future: Add GraphQL adapter for batched queries in scan mode.
 */
export function createGitHubAdapter(): GitHubPort {
  const token = process.env['GITHUB_TOKEN']
  return createGitHubRestAdapter(token)
}

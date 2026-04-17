import { err, ok, type Result } from 'neverthrow'

export interface RepoCoordinates {
  readonly owner: string
  readonly repo: string
}

interface ParseError {
  readonly kind: 'parse-error'
  readonly message: string
  readonly raw: string
}

const GITHUB_RE = /github\.com[/:]([\w.-]+)\/([\w.-]+)/

/**
 * Extract GitHub owner/repo from an npm registry repository field.
 *
 * Handles all known formats:
 *   - Object: { type: "git", url: "https://github.com/user/repo.git" }
 *   - Shorthand: "github:user/repo", "user/repo"
 *   - String URL: "https://github.com/user/repo"
 *   - git+https, git+ssh, ssh://git@ prefixes
 *   - Monorepo subpaths: "https://github.com/user/repo/tree/main/packages/foo"
 */
export function parseGitHubRepo(repository: unknown): Result<RepoCoordinates, ParseError> {
  const url = extractUrl(repository)
  if (!url) {
    return err({
      kind: 'parse-error',
      message: 'Could not extract URL from repository field',
      raw: String(repository),
    })
  }

  // Try shorthand format first: "user/repo" or "github:user/repo"
  const shorthand = parseShorthand(url)
  if (shorthand) return ok(shorthand)

  // Try regex match against various URL formats
  const match = GITHUB_RE.exec(url)
  if (!match?.[1] || !match[2]) {
    return err({
      kind: 'parse-error',
      message: 'Not a GitHub repository URL',
      raw: url,
    })
  }

  return ok({
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
  })
}

function extractUrl(repository: unknown): string | null {
  if (typeof repository === 'string') return repository

  if (typeof repository === 'object' && repository !== null) {
    const obj = repository as Record<string, unknown>
    if (typeof obj['url'] === 'string') return obj['url']
  }

  return null
}

function parseShorthand(input: string): RepoCoordinates | null {
  // "github:user/repo"
  if (input.startsWith('github:')) {
    const rest = input.slice(7)
    return parseOwnerRepo(rest)
  }

  // "user/repo" (no protocol, no dots, exactly one slash)
  if (!input.includes('://') && !input.includes('.') && !input.startsWith('@')) {
    return parseOwnerRepo(input)
  }

  return null
}

function parseOwnerRepo(input: string): RepoCoordinates | null {
  const parts = input.split('/')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] }
  }
  return null
}

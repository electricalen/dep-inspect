import * as semver from 'semver'

import type { GitHubRepoData } from '../../../ports/github.port.js'
import type { PackageMetadata, RepositoryInfo } from '../../../ports/registry.port.js'
import type { Flag } from '../flag.types.js'

/**
 * Detect metadata-related flags: missing repository, version risk.
 *
 * Pure function — no I/O.
 */
export function detectMetadataIssues(
  metadata: PackageMetadata,
  github?: GitHubRepoData,
  repoParseSuccess?: boolean,
): Flag[] {
  const flags: Flag[] = []

  // Missing repository
  flags.push(...detectMissingRepository(metadata.repository, repoParseSuccess, github))

  // Version risk
  flags.push(...detectVersionRisk(metadata.version, metadata.latestVersion))

  return flags
}

function detectMissingRepository(
  repository: RepositoryInfo | undefined,
  repoParseSuccess?: boolean,
  _github?: GitHubRepoData,
): Flag[] {
  if (!repository?.url) {
    return [{ kind: 'missing-repository', reason: 'no-field' }]
  }

  if (repoParseSuccess === false) {
    return [{ kind: 'missing-repository', reason: 'not-github' }]
  }

  // If we tried to fetch GitHub data and it failed with 404
  // This case is handled by the orchestrator when GitHub returns an error

  return []
}

function detectVersionRisk(currentVersion: string, latestVersion: string): Flag[] {
  if (!latestVersion || currentVersion === latestVersion) return []

  const current = semver.parse(currentVersion)
  const latest = semver.parse(latestVersion)

  if (!current || !latest) return []

  // Prerelease check
  if (current.prerelease.length > 0) {
    return [
      {
        kind: 'version-risk',
        issue: 'prerelease',
        currentVersion,
        latestVersion,
      },
    ]
  }

  // Major version lag (only flag if >= 2 majors behind)
  const majorsBehind = latest.major - current.major
  if (majorsBehind >= 2) {
    return [
      {
        kind: 'version-risk',
        issue: 'major-lag',
        currentVersion,
        latestVersion,
        majorVersionsBehind: majorsBehind,
      },
    ]
  }

  return []
}

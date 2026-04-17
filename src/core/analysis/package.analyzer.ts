import { ResultAsync, okAsync } from 'neverthrow'

import { parseGitHubRepo } from '../../adapters/github/repo-url-parser.js'
import type { GitHubPort, GitHubRepoData } from '../../ports/github.port.js'
import type { DownloadCount, PackageMetadata, RegistryPort } from '../../ports/registry.port.js'
import type { VulnerabilityPort } from '../../ports/vulnerability.port.js'
import type { AppError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import { detectLicenseIssues } from '../flags/detectors/license.detector.js'
import { detectMaintenanceIssues } from '../flags/detectors/maintenance.detector.js'
import { detectMetadataIssues } from '../flags/detectors/metadata.detector.js'
import { detectSupplyChainIssues } from '../flags/detectors/supply-chain.detector.js'
import { detectVulnerabilities } from '../flags/detectors/vulnerability.detector.js'
import type { Flag, PackageFinding } from '../flags/flag.types.js'
import { applyPolicyToPackage, resolveThreshold } from '../policy/policy.evaluator.js'
import type { PolicyConfig } from '../policy/policy.types.js'

/**
 * Result of analyzing a single package.
 * Contains everything needed for the `inspect` and `explain` commands.
 */
export interface PackageAnalysis {
  readonly metadata: PackageMetadata
  readonly downloads: DownloadCount | undefined
  readonly github: GitHubRepoData | undefined
  readonly finding: PackageFinding | null
  readonly rawFlags: readonly Flag[]
  /** True if the vulnerability database query failed — results are unreliable. */
  readonly vulnQueryFailed: boolean
}

/** Options for single-package analysis. */
export interface PackageAnalyzerOptions {
  readonly registry: RegistryPort
  readonly vulnerability: VulnerabilityPort
  readonly github?: GitHubPort | undefined
  readonly policy: PolicyConfig
}

/**
 * Analyze a single package for risk signals.
 *
 * Fetches metadata, vulnerabilities, GitHub health (if enabled), and download
 * counts in parallel, then runs all detectors and applies policy.
 *
 * Used by: `inspect`, `explain` commands.
 */
export function analyzePackage(
  name: string,
  version: string | undefined,
  options: PackageAnalyzerOptions,
): ResultAsync<PackageAnalysis, AppError> {
  const { registry, vulnerability, github, policy } = options

  // Step 1: Fetch metadata first (we need it for version + repo URL)
  return registry.getPackageMetadata(name, version).andThen((metadata) => {
    // Step 2: Fetch remaining data in parallel
    const vulnFetch = vulnerability
      .query(metadata.name, metadata.version)
      .map((advisories) => ({ advisories, failed: false }))
      .orElse((e) => {
        logger.warn(
          `Vulnerability lookup FAILED for ${metadata.name}@${metadata.version}: ${e.message} — cannot confirm absence of vulnerabilities`,
        )
        return okAsync({ advisories: [] as const, failed: true })
      })

    const downloadFetch = registry.getDownloadCounts(metadata.name).orElse((e) => {
      logger.debug(`Download count fetch failed for ${metadata.name}: ${e.message}`)
      return okAsync(undefined)
    })

    const githubFetch = fetchGitHubData(metadata, github)

    // Combine all parallel fetches
    return ResultAsync.combine([vulnFetch, downloadFetch, githubFetch] as const).map(
      ([vulnResult, downloads, githubResult]) => {
        const githubData = githubResult.data

        // Determine if repo URL parses as GitHub — independent of whether we fetched
        let repoParseSuccess: boolean | undefined
        if (metadata.repository?.url) {
          repoParseSuccess = parseGitHubRepo(metadata.repository).isOk()
        }

        // Step 3: Run all detectors
        const thresholdDays = resolveThreshold('unmaintained', policy) ?? 730
        const flags: Flag[] = [
          ...detectVulnerabilities(vulnResult.advisories),
          ...detectLicenseIssues(metadata.license, policy.licenses),
          ...detectMaintenanceIssues(metadata, thresholdDays, githubData),
          ...detectSupplyChainIssues(metadata),
          ...detectMetadataIssues(metadata, githubData, repoParseSuccess),
        ]

        // Step 4: Apply policy
        const finding = applyPolicyToPackage(
          metadata.name,
          flags,
          policy,
          true, // single-package analysis treats as direct
          true, // and runtime
        )

        // Patch version onto finding
        const patchedFinding = finding ? { ...finding, version: metadata.version } : null

        return {
          metadata,
          downloads: downloads ?? undefined,
          github: githubData,
          finding: patchedFinding,
          rawFlags: flags,
          vulnQueryFailed: vulnResult.failed,
        }
      },
    )
  })
}

/**
 * Fetch GitHub data for a package, gracefully handling failures.
 * Returns undefined if GitHub is disabled, repo URL is unparseable, or API fails.
 */
interface GitHubFetchResult {
  readonly data: GitHubRepoData | undefined
}

function fetchGitHubData(
  metadata: PackageMetadata,
  github: GitHubPort | undefined,
): ResultAsync<GitHubFetchResult, never> {
  if (!github) {
    return okAsync({ data: undefined })
  }

  if (!metadata.repository?.url) {
    return okAsync({ data: undefined })
  }

  const parseResult = parseGitHubRepo(metadata.repository)
  if (parseResult.isErr()) {
    logger.debug(`Could not parse GitHub URL for ${metadata.name}: ${parseResult.error.message}`)
    return okAsync({ data: undefined })
  }

  const { owner, repo } = parseResult.value

  return github
    .fetchRepo(owner, repo)
    .map((data): GitHubFetchResult => ({ data }))
    .orElse((e) => {
      logger.warn(`GitHub data unavailable for ${owner}/${repo}: ${e.message}`)
      return okAsync({ data: undefined })
    })
}

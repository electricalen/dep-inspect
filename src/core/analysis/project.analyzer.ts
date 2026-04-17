import { type Result, ResultAsync } from 'neverthrow'

import { parseGitHubRepo } from '../../adapters/github/repo-url-parser.js'
import type { LockfileData } from '../../adapters/lockfile/lockfile.types.js'
import type { GitHubPort, GitHubRepoData } from '../../ports/github.port.js'
import type { LockfilePort } from '../../ports/lockfile.port.js'
import type { PackageMetadata, RegistryPort } from '../../ports/registry.port.js'
import type { VulnerabilityPort } from '../../ports/vulnerability.port.js'
import type { AppError, LockfileParseError } from '../../shared/errors.js'
import { createConcurrencyLimiter } from '../../shared/concurrency.js'
import { logger } from '../../shared/logger.js'
import { detectLicenseIssues } from '../flags/detectors/license.detector.js'
import { detectMaintenanceIssues } from '../flags/detectors/maintenance.detector.js'
import { detectMetadataIssues } from '../flags/detectors/metadata.detector.js'
import { detectSupplyChainIssues } from '../flags/detectors/supply-chain.detector.js'
import { detectTreeIssues } from '../flags/detectors/tree.detector.js'
import { detectVulnerabilities } from '../flags/detectors/vulnerability.detector.js'
import type { Flag, FlagKind, PackageFinding } from '../flags/flag.types.js'
import { buildDepGraph } from '../graph/graph.builder.js'
import type { DepGraph, DepNode, GraphMetrics } from '../graph/graph.types.js'
import {
  applyPolicyToPackage,
  evaluatePolicy,
  resolveThreshold,
} from '../policy/policy.evaluator.js'
import type { PolicyConfig, PolicyResult } from '../policy/policy.types.js'

/**
 * Result of analyzing an entire project's dependency tree.
 * Contains everything needed for `scan`, `ci`, and `report` commands.
 */
export interface ProjectAnalysis {
  readonly graph: DepGraph
  readonly metrics: GraphMetrics
  readonly policyResult: PolicyResult
  readonly treeFlags: readonly Flag[]
  readonly githubEnabled: boolean
  readonly scanStats: ScanStatistics
}

/**
 * Detailed statistics about what was scanned and what was found.
 * Gives developers confidence that dependencies were actually verified.
 */
export interface ScanStatistics {
  /** Total unique packages in the tree. */
  readonly totalPackages: number
  /** Packages successfully analyzed (metadata fetched). */
  readonly scannedSuccessfully: number
  /** Packages skipped due to fetch errors. */
  readonly skippedPackages: number
  /** Packages with zero flags (fully clean). */
  readonly cleanPackages: number
  /** Packages with at least one flag (before policy filtering). */
  readonly flaggedPackages: number
  /** How many packages triggered each flag kind (pre-policy). */
  readonly flagCounts: Partial<Record<FlagKind, number>>
  /** Total individual vulnerability advisories found across all packages. */
  readonly totalVulnerabilities: number
  /** Names of packages that were skipped. */
  readonly skippedNames: readonly string[]
  /** Packages where the vulnerability lookup failed (not reliably scanned). */
  readonly vulnQueryFailures: readonly string[]
}

/** Options for project-wide analysis. */
export interface ProjectAnalyzerOptions {
  readonly registry: RegistryPort
  readonly vulnerability: VulnerabilityPort
  readonly lockfile: LockfilePort
  readonly github?: GitHubPort | undefined
  readonly policy: PolicyConfig
  readonly concurrency?: number | undefined
}

/** Package.json shape needed for graph building. */
interface PackageJson {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/**
 * Analyze all dependencies in a project.
 *
 * 1. Parse lockfile and build dependency graph
 * 2. Fetch metadata + vulnerabilities for each unique package (concurrency-limited)
 * 3. Optionally fetch GitHub data (with monorepo dedup)
 * 4. Run detectors on each package
 * 5. Apply policy and produce findings
 *
 * Used by: `scan`, `ci`, `report` commands.
 */
export function analyzeProject(
  projectDir: string,
  packageJson: PackageJson,
  options: ProjectAnalyzerOptions,
): Result<ResultAsync<ProjectAnalysis, AppError>, LockfileParseError> {
  const lockfileResult = options.lockfile.parse(projectDir)
  return lockfileResult.map((lockfileData) =>
    runProjectAnalysis(packageJson, lockfileData, options),
  )
}

/**
 * Analyze a project from pre-parsed lockfile data (same pipeline as `analyzeProject`).
 *
 * Used by: `deep-inspect` (registry-resolved tree).
 */
export function analyzeProjectFromLockfileData(
  packageJson: PackageJson,
  lockfileData: LockfileData,
  options: ProjectAnalyzerOptions,
): ResultAsync<ProjectAnalysis, AppError> {
  return runProjectAnalysis(packageJson, lockfileData, options)
}

function runProjectAnalysis(
  packageJson: PackageJson,
  lockfileData: LockfileData,
  options: ProjectAnalyzerOptions,
): ResultAsync<ProjectAnalysis, AppError> {
  const { registry, vulnerability, github, policy, concurrency: maxConcurrency } = options
  const limiter = createConcurrencyLimiter(maxConcurrency ?? 10)

  const graph = buildDepGraph(lockfileData, packageJson)
  const metrics = graph.metrics()
  const thresholdDays = resolveThreshold('unmaintained', policy) ?? 730

  const uniquePackages = collectUniquePackages(graph)
  logger.info(`Analyzing ${uniquePackages.length} unique packages...`)

  const analysisAsync = analyzeAllPackages(
    uniquePackages,
    graph,
    { registry, vulnerability, github, policy, thresholdDays },
    limiter,
  )

  return analysisAsync.map(({ findings, scanStats }) => {
    const treeFlags = detectTreeIssues(metrics)
    const policyResult = evaluatePolicy(findings, policy)

    return {
      graph,
      metrics,
      policyResult,
      treeFlags,
      githubEnabled: github !== undefined,
      scanStats,
    }
  })
}

/** Unique package entry for analysis. */
interface UniquePackage {
  readonly name: string
  readonly version: string
  readonly node: DepNode
  /** Which direct dependency introduced this transitive (if transitive). */
  readonly introducedBy: string | undefined
}

/**
 * Collect unique packages from the graph, deduplicating by name@version.
 * For transitives, determine which direct dependency introduced them.
 */
function collectUniquePackages(graph: DepGraph): UniquePackage[] {
  const packages: UniquePackage[] = []
  const seen = new Set<string>()

  for (const [key, node] of graph.allNodes()) {
    const id = `${node.name}@${node.version}`
    if (seen.has(id)) continue
    seen.add(id)

    // For transitive deps, find the direct dep that introduced them
    let introducedBy: string | undefined
    if (!node.isDirect) {
      introducedBy = findIntroducer(key, graph)
    }

    packages.push({
      name: node.name,
      version: node.version,
      node,
      introducedBy,
    })
  }

  return packages
}

/**
 * Walk up from a transitive dep to find which direct dep introduced it.
 * Uses BFS over reverse edges (parents).
 */
function findIntroducer(targetKey: string, graph: DepGraph): string | undefined {
  // Build reverse adjacency: for each node, find which nodes have it as a child
  const allNodes = graph.allNodes()

  for (const [parentKey, parentNode] of allNodes) {
    if (!parentNode.isDirect) continue
    if (containsTransitively(targetKey, parentKey, graph, new Set())) {
      return parentNode.name
    }
  }

  return undefined
}

/** Check if target is reachable from source via DFS. */
function containsTransitively(
  target: string,
  source: string,
  graph: DepGraph,
  visited: Set<string>,
): boolean {
  if (source === target) return true
  if (visited.has(source)) return false
  visited.add(source)

  for (const childKey of graph.childrenOf(source)) {
    if (containsTransitively(target, childKey, graph, visited)) return true
  }

  return false
}

/** Internal context for analyzing packages. */
interface AnalysisContext {
  readonly registry: RegistryPort
  readonly vulnerability: VulnerabilityPort
  readonly github: GitHubPort | undefined
  readonly policy: PolicyConfig
  readonly thresholdDays: number
}

/** Result from analyzing a single package in the project context. */
interface SinglePackageResult {
  readonly finding: PackageFinding | null
  readonly rawFlags: readonly Flag[]
  readonly skipped: boolean
  readonly vulnQueryFailed: boolean
  readonly name: string
  readonly version: string
}

/** Combined result: findings + scan statistics. */
interface AllPackagesResult {
  readonly findings: PackageFinding[]
  readonly scanStats: ScanStatistics
}

/**
 * Analyze all packages: fetch data, run detectors, apply policy.
 * GitHub fetches are deduped by owner/repo to handle monorepos.
 */
function analyzeAllPackages(
  packages: readonly UniquePackage[],
  graph: DepGraph,
  ctx: AnalysisContext,
  limiter: ReturnType<typeof createConcurrencyLimiter>,
): ResultAsync<AllPackagesResult, never> {
  // Pre-fetch GitHub data with monorepo dedup
  const githubFetchPromise = ctx.github
    ? prefetchGitHubData(packages, ctx.registry, ctx.github, limiter)
    : Promise.resolve(new Map<string, GitHubRepoData>())

  return ResultAsync.fromSafePromise(githubFetchPromise).andThen((githubCache) => {
    // Analyze each package concurrently
    const analyzePromise = limiter.map(packages, async (pkg) => {
      return analyzeSingleInProject(pkg, ctx, githubCache)
    })

    return ResultAsync.fromSafePromise(analyzePromise).map((results) => {
      // Collect findings and compute scan statistics
      const findings: PackageFinding[] = []
      const flagCounts: Partial<Record<FlagKind, number>> = {}
      let scannedSuccessfully = 0
      let skippedPackages = 0
      let cleanPackages = 0
      let flaggedPackages = 0
      let totalVulnerabilities = 0
      const skippedNames: string[] = []
      const vulnQueryFailures: string[] = []

      for (const result of results) {
        if (result.skipped) {
          skippedPackages++
          skippedNames.push(result.name)
          continue
        }

        scannedSuccessfully++

        if (result.vulnQueryFailed) {
          vulnQueryFailures.push(`${result.name}@${result.version}`)
        }

        if (result.rawFlags.length === 0) {
          cleanPackages++
        } else {
          flaggedPackages++
        }

        // Count per-category flags
        for (const flag of result.rawFlags) {
          flagCounts[flag.kind] = (flagCounts[flag.kind] ?? 0) + 1
          if (flag.kind === 'vulnerability') {
            totalVulnerabilities += flag.vulnerabilities.length
          }
        }

        if (result.finding) {
          findings.push(result.finding)
        }
      }

      const scanStats: ScanStatistics = {
        totalPackages: packages.length,
        scannedSuccessfully,
        skippedPackages,
        cleanPackages,
        flaggedPackages,
        flagCounts,
        totalVulnerabilities,
        skippedNames,
        vulnQueryFailures,
      }

      return { findings, scanStats }
    })
  })
}

/**
 * Analyze a single package within a project scan context.
 * Fetches metadata + vulnerabilities, runs detectors, applies policy.
 * Always returns a result (including for clean packages) so scan stats can be computed.
 */
async function analyzeSingleInProject(
  pkg: UniquePackage,
  ctx: AnalysisContext,
  githubCache: Map<string, GitHubRepoData>,
): Promise<SinglePackageResult> {
  // Fetch metadata
  const metadataResult = await ctx.registry.getPackageMetadata(pkg.name, pkg.version)
  if (metadataResult.isErr()) {
    logger.warn(
      `Failed to fetch metadata for ${pkg.name}@${pkg.version}: ${metadataResult.error.message}`,
    )
    return {
      finding: null,
      rawFlags: [],
      skipped: true,
      vulnQueryFailed: false,
      name: pkg.name,
      version: pkg.version,
    }
  }
  const metadata = metadataResult.value

  // Fetch vulnerabilities
  const vulnResult = await ctx.vulnerability.query(pkg.name, pkg.version)
  const advisories = vulnResult.isOk() ? vulnResult.value : []
  const vulnQueryFailed = vulnResult.isErr()
  if (vulnQueryFailed) {
    logger.warn(
      `Vulnerability lookup failed for ${pkg.name}@${pkg.version}: ${vulnResult.error.message}`,
    )
  }

  // Look up GitHub data from pre-fetched cache
  const githubData = lookupGitHubData(metadata, githubCache)

  // Determine repo parse success
  let repoParseSuccess: boolean | undefined
  if (metadata.repository?.url) {
    repoParseSuccess = parseGitHubRepo(metadata.repository).isOk()
  }

  // Run detectors
  const flags: Flag[] = [
    ...detectVulnerabilities(advisories),
    ...detectLicenseIssues(metadata.license, ctx.policy.licenses),
    ...detectMaintenanceIssues(metadata, ctx.thresholdDays, githubData),
    ...detectSupplyChainIssues(metadata),
    ...detectMetadataIssues(metadata, githubData, repoParseSuccess),
  ]

  // Apply policy
  const finding = applyPolicyToPackage(
    pkg.name,
    flags,
    ctx.policy,
    pkg.node.isDirect,
    pkg.node.isRuntime,
    pkg.introducedBy,
  )

  // Patch version
  const patchedFinding = finding ? { ...finding, version: metadata.version } : null

  return {
    finding: patchedFinding,
    rawFlags: flags,
    skipped: false,
    vulnQueryFailed,
    name: pkg.name,
    version: metadata.version,
  }
}

/**
 * Pre-fetch GitHub data for all packages, deduplicating by owner/repo.
 * This prevents fetching the same repo multiple times for monorepo packages.
 */
async function prefetchGitHubData(
  packages: readonly UniquePackage[],
  registry: RegistryPort,
  github: GitHubPort,
  limiter: ReturnType<typeof createConcurrencyLimiter>,
): Promise<Map<string, GitHubRepoData>> {
  const repoToPackages = new Map<string, string[]>()
  const repoCoords = new Map<string, { owner: string; repo: string }>()

  // First pass: collect unique repos from metadata we already have
  // We need metadata to get repo URLs — but we haven't fetched it yet at this point.
  // Instead, we'll do a lightweight fetch pass to get repo URLs.
  logger.debug('Pre-fetching GitHub data for unique repositories...')

  // Build repo → packages mapping by fetching metadata
  const metadataResults = await limiter.map(packages, async (pkg) => {
    const result = await registry.getPackageMetadata(pkg.name, pkg.version)
    return { pkg, result }
  })

  for (const { pkg, result } of metadataResults) {
    if (result.isErr() || !result.value.repository?.url) continue

    const parseResult = parseGitHubRepo(result.value.repository)
    if (parseResult.isErr()) continue

    const { owner, repo } = parseResult.value
    const repoKey = `${owner}/${repo}`

    if (!repoToPackages.has(repoKey)) {
      repoToPackages.set(repoKey, [])
      repoCoords.set(repoKey, { owner, repo })
    }
    repoToPackages.get(repoKey)?.push(pkg.name)
  }

  logger.debug(`Found ${repoCoords.size} unique GitHub repos to fetch`)

  // Fetch each unique repo
  const githubCache = new Map<string, GitHubRepoData>()
  const repoKeys = [...repoCoords.keys()]

  await limiter.map(repoKeys, async (repoKey) => {
    const coords = repoCoords.get(repoKey)
    if (!coords) return

    const result = await github.fetchRepo(coords.owner, coords.repo)
    if (result.isOk()) {
      githubCache.set(repoKey, result.value)
    } else {
      logger.debug(`GitHub fetch failed for ${repoKey}: ${result.error.message}`)
    }
  })

  return githubCache
}

/**
 * Look up GitHub data for a package from the pre-fetched cache.
 */
function lookupGitHubData(
  metadata: PackageMetadata,
  githubCache: Map<string, GitHubRepoData>,
): GitHubRepoData | undefined {
  if (githubCache.size === 0 || !metadata.repository?.url) return undefined

  const parseResult = parseGitHubRepo(metadata.repository)
  if (parseResult.isErr()) return undefined

  const { owner, repo } = parseResult.value
  return githubCache.get(`${owner}/${repo}`)
}

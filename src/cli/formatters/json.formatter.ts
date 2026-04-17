import type { PackageAnalysis } from '../../core/analysis/package.analyzer.js'
import type { ProjectAnalysis } from '../../core/analysis/project.analyzer.js'
import { FLAG_METADATA } from '../../core/flags/flag.registry.js'
import type { Flag, FlagKind, PackageFinding } from '../../core/flags/flag.types.js'
import { buildSeverityMap } from '../../core/policy/policy.evaluator.js'
import type { PolicyConfig } from '../../core/policy/policy.types.js'
import type { Severity } from '../../shared/types.js'

// ── JSON Output Types ──────────────────────────────────────────────────────

interface JsonInspectOutput {
  readonly package: JsonPackageInfo
  readonly flags: readonly JsonFlag[]
  readonly github: JsonGitHubInfo | null
  readonly riskLevel: Severity
  readonly vulnQueryFailed: boolean
}

interface JsonPackageInfo {
  readonly name: string
  readonly version: string
  readonly description: string | null
  readonly license: string | null
  readonly weeklyDownloads: number | null
  readonly repositoryUrl: string | null
}

interface JsonFlag {
  readonly kind: FlagKind
  readonly severity: Severity
  readonly signalType: 'evidence' | 'heuristic'
  readonly label: string
  readonly description: string
  readonly details: Record<string, unknown>
}

interface JsonGitHubInfo {
  readonly owner: string
  readonly repo: string
  readonly stars: number
  readonly forks: number
  readonly contributorCount: number
  readonly lastCommitDate: string
  readonly openIssues: number
  readonly closedIssues: number
  readonly isArchived: boolean
  readonly commitsLast12Months: number
}

interface JsonScanOutput {
  readonly summary: JsonSummary
  readonly findings: readonly JsonFinding[]
  readonly treeFlags: readonly JsonFlag[]
}

interface JsonSummary {
  readonly totalDirect: number
  readonly totalTransitive: number
  readonly criticalCount: number
  readonly warningCount: number
  readonly infoCount: number
  readonly status: 'pass' | 'fail'
}

interface JsonFinding {
  readonly name: string
  readonly version: string
  readonly isDirect: boolean
  readonly isRuntime: boolean
  readonly introducedBy: string | null
  readonly flags: readonly JsonFlag[]
  readonly waived: readonly { flag: FlagKind; reason: string }[]
  readonly highestSeverity: Severity
}

// ── Formatters ─────────────────────────────────────────────────────────────

/**
 * Format a single-package analysis as JSON.
 */
export function formatInspectJson(analysis: PackageAnalysis, policy: PolicyConfig): string {
  const severityMap = buildSeverityMap(policy)
  const { metadata, downloads, github, finding } = analysis
  const activeFlags = finding?.flags ?? []

  const output: JsonInspectOutput = {
    package: {
      name: metadata.name,
      version: metadata.version,
      description: metadata.description ?? null,
      license: metadata.license ?? null,
      weeklyDownloads: downloads?.weekly ?? null,
      repositoryUrl: metadata.repository?.url ?? null,
    },
    flags: activeFlags.map((f) => toJsonFlag(f, severityMap)),
    github: github
      ? {
          owner: github.owner,
          repo: github.repo,
          stars: github.stars,
          forks: github.forks,
          contributorCount: github.contributorCount,
          lastCommitDate: github.lastCommitDate.toISOString(),
          openIssues: github.openIssues,
          closedIssues: github.closedIssues,
          isArchived: github.isArchived,
          commitsLast12Months: github.commitsLast12Months,
        }
      : null,
    riskLevel: findMaxSeverity(activeFlags, severityMap),
    vulnQueryFailed: analysis.vulnQueryFailed,
  }

  return JSON.stringify(output, null, 2)
}

/** JSON shape for `deep-inspect` — inspect-style root plus tree findings and summary. */
export interface JsonDeepInspectOutput {
  readonly root: unknown
  readonly tree: {
    readonly totalDirect: number
    readonly totalTransitive: number
    readonly uniquePackages: number
    readonly maxDepth: number
  }
  readonly verification: {
    readonly totalPackages: number
    readonly scannedSuccessfully: number
    readonly skippedPackages: number
    readonly cleanPackages: number
    readonly flaggedPackages: number
    readonly coveragePercent: number
    readonly flagCounts: Partial<Record<FlagKind, number>>
    readonly totalVulnerabilities: number
    readonly skippedNames: readonly string[]
    readonly vulnQueryFailures: readonly string[]
  }
  readonly dependencyFindings: readonly JsonFinding[]
  readonly treeFlags: readonly JsonFlag[]
  readonly combinedSummary: {
    readonly criticalCount: number
    readonly warningCount: number
    readonly infoCount: number
    readonly status: 'pass' | 'fail'
    readonly criticalPackages: readonly {
      readonly name: string
      readonly version: string
      readonly location: string
      readonly flags: readonly JsonFlag[]
    }[]
  }
}

/**
 * Format deep-inspect output: full inspect payload for the root plus scan-style findings (JSON).
 */
export function formatDeepInspectJson(
  rootAnalysis: PackageAnalysis,
  projectAnalysis: ProjectAnalysis,
  policy: PolicyConfig,
): string {
  const severityMap = buildSeverityMap(policy)
  const { metrics, policyResult, treeFlags, scanStats } = projectAnalysis
  const rootName = rootAnalysis.metadata.name
  const rootVersion = rootAnalysis.metadata.version

  const dependencyFindings = policyResult.findings.filter(
    (f) => !(f.name === rootName && f.version === rootVersion),
  )

  const criticalPackages = policyResult.findings
    .filter((f) => f.flags.some((fl) => severityMap[fl.kind] === 'critical'))
    .map((f) => {
      const loc =
        f.name === rootName && f.version === rootVersion
          ? 'root'
          : f.isDirect
            ? 'direct'
            : `transitive_via_${f.introducedBy ?? 'unknown'}`
      return {
        name: f.name,
        version: f.version,
        location: loc,
        flags: f.flags
          .filter((fl) => severityMap[fl.kind] === 'critical')
          .map((fl) => toJsonFlag(fl, severityMap)),
      }
    })

  const coveragePercent =
    scanStats.totalPackages > 0
      ? Math.round((scanStats.scannedSuccessfully / scanStats.totalPackages) * 100)
      : 100

  const output: JsonDeepInspectOutput = {
    root: JSON.parse(formatInspectJson(rootAnalysis, policy)) as unknown,
    tree: {
      totalDirect: metrics.directCount,
      totalTransitive: metrics.transitiveCount,
      uniquePackages: metrics.totalPackages,
      maxDepth: metrics.maxDepth,
    },
    verification: {
      totalPackages: scanStats.totalPackages,
      scannedSuccessfully: scanStats.scannedSuccessfully,
      skippedPackages: scanStats.skippedPackages,
      cleanPackages: scanStats.cleanPackages,
      flaggedPackages: scanStats.flaggedPackages,
      coveragePercent,
      flagCounts: scanStats.flagCounts,
      totalVulnerabilities: scanStats.totalVulnerabilities,
      skippedNames: scanStats.skippedNames,
      vulnQueryFailures: scanStats.vulnQueryFailures,
    },
    dependencyFindings: dependencyFindings.map((f) => toJsonFinding(f, severityMap)),
    treeFlags: treeFlags.map((f) => toJsonFlag(f, severityMap)),
    combinedSummary: {
      criticalCount: policyResult.criticalCount,
      warningCount: policyResult.warningCount,
      infoCount: policyResult.infoCount,
      status: policyResult.status,
      criticalPackages,
    },
  }

  return JSON.stringify(output, null, 2)
}

/**
 * Format a project-wide scan as JSON.
 */
export function formatScanJson(analysis: ProjectAnalysis, policy: PolicyConfig): string {
  const severityMap = buildSeverityMap(policy)
  const { metrics, policyResult, treeFlags } = analysis

  const output: JsonScanOutput = {
    summary: {
      totalDirect: metrics.directCount,
      totalTransitive: metrics.transitiveCount,
      criticalCount: policyResult.criticalCount,
      warningCount: policyResult.warningCount,
      infoCount: policyResult.infoCount,
      status: policyResult.status,
    },
    findings: policyResult.findings.map((f) => toJsonFinding(f, severityMap)),
    treeFlags: treeFlags.map((f) => toJsonFlag(f, severityMap)),
  }

  return JSON.stringify(output, null, 2)
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toJsonFlag(flag: Flag, severityMap: Record<FlagKind, Severity>): JsonFlag {
  const meta = FLAG_METADATA[flag.kind]
  const { kind, ...details } = flag
  const signalType =
    kind === 'single-maintainer' ||
    kind === 'license-risk' ||
    kind === 'dependency-footprint' ||
    kind === 'missing-repository' ||
    kind === 'version-risk'
      ? 'heuristic'
      : 'evidence'

  return {
    kind,
    severity: severityMap[kind],
    signalType,
    label: meta.label,
    description: meta.description,
    details: details as Record<string, unknown>,
  }
}

function toJsonFinding(
  finding: PackageFinding,
  severityMap: Record<FlagKind, Severity>,
): JsonFinding {
  return {
    name: finding.name,
    version: finding.version,
    isDirect: finding.isDirect,
    isRuntime: finding.isRuntime,
    introducedBy: finding.introducedBy ?? null,
    flags: finding.flags.map((f) => toJsonFlag(f, severityMap)),
    waived: finding.waived.map((w) => ({ flag: w.flag, reason: w.reason })),
    highestSeverity: findMaxSeverity(finding.flags, severityMap),
  }
}

function findMaxSeverity(
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
): Severity {
  if (flags.length === 0) return 'info'
  let max: Severity = 'info'
  for (const flag of flags) {
    const sev = severityMap[flag.kind]
    if (sev === 'critical') return 'critical'
    if (sev === 'warning') max = 'warning'
  }
  return max
}

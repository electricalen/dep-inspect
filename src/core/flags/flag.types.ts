import type { PackageName, Severity } from '../../shared/types.js'

// ── Flag Discriminated Union ────────────────────────────────────────────────
// Each flag kind carries its own evidence data, making the type self-documenting.

export type Flag =
  | VulnerabilityFlag
  | DeprecatedFlag
  | LicenseViolationFlag
  | InstallScriptsFlag
  | UnmaintainedFlag
  | SingleMaintainerFlag
  | LicenseRiskFlag
  | DependencyFootprintFlag
  | MissingRepositoryFlag
  | VersionRiskFlag

export interface VulnerabilityFlag {
  readonly kind: 'vulnerability'
  readonly vulnerabilities: readonly VulnerabilityDetail[]
}

export interface VulnerabilityDetail {
  readonly id: string
  readonly severity: 'critical' | 'high' | 'medium' | 'low'
  readonly summary: string
  readonly fixAvailable: boolean
}

export interface DeprecatedFlag {
  readonly kind: 'deprecated'
  readonly reason: string
}

export interface LicenseViolationFlag {
  readonly kind: 'license-violation'
  readonly license: string | null
  readonly violation: 'denied' | 'unknown' | 'missing'
}

export interface InstallScriptsFlag {
  readonly kind: 'install-scripts'
  readonly scripts: readonly string[]
}

export interface UnmaintainedFlag {
  readonly kind: 'unmaintained'
  readonly lastPublishDate: Date
  readonly daysSincePublish: number
  readonly thresholdDays: number
  readonly isArchived?: boolean | undefined
  readonly commitsLast12Months?: number | undefined
}

export interface SingleMaintainerFlag {
  readonly kind: 'single-maintainer'
  readonly npmMaintainerCount: number
  readonly githubContributorCount?: number | undefined
}

export interface LicenseRiskFlag {
  readonly kind: 'license-risk'
  readonly license: string
  readonly risk: 'uncommon' | 'non-standard'
}

export interface DependencyFootprintFlag {
  readonly kind: 'dependency-footprint'
  readonly transitiveCount: number
  readonly uniqueCount: number
  readonly duplicatedCount: number
  readonly maxDepth: number
}

export interface MissingRepositoryFlag {
  readonly kind: 'missing-repository'
  readonly reason: 'no-field' | 'not-github' | 'repo-404'
}

export interface VersionRiskFlag {
  readonly kind: 'version-risk'
  readonly issue: 'major-lag' | 'prerelease'
  readonly currentVersion: string
  readonly latestVersion: string
  readonly majorVersionsBehind?: number | undefined
}

// ── Flag Kind Union ─────────────────────────────────────────────────────────

export type FlagKind = Flag['kind']

// ── Package Finding ─────────────────────────────────────────────────────────
// A finding associates flags with a specific package and its position in the
// dependency tree.

export interface PackageFinding {
  readonly name: PackageName
  readonly version: string
  readonly flags: readonly Flag[]
  readonly isDirect: boolean
  readonly isRuntime: boolean
  readonly introducedBy?: PackageName | undefined
  readonly waived: readonly WaivedFlag[]
}

export interface WaivedFlag {
  readonly flag: FlagKind
  readonly reason: string
}

// ── Severity Classification ─────────────────────────────────────────────────

/** Determine the highest severity among a set of flags. */
export function highestSeverity(
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
): Severity {
  let highest: Severity = 'info'

  for (const flag of flags) {
    const severity = severityMap[flag.kind]
    if (severity === 'critical') return 'critical'
    if (severity === 'warning' && highest === 'info') {
      highest = 'warning'
    }
  }

  return highest
}

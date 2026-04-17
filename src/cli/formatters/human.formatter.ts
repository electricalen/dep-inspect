import chalk from 'chalk'

import type { PackageAnalysis } from '../../core/analysis/package.analyzer.js'
import type { ProjectAnalysis, ScanStatistics } from '../../core/analysis/project.analyzer.js'
import { FLAG_METADATA } from '../../core/flags/flag.registry.js'
import type { Flag, FlagKind, PackageFinding } from '../../core/flags/flag.types.js'
import {
  buildSeverityMap,
  getFindingSeverity,
  getFlagSeverity,
  resolveThreshold,
} from '../../core/policy/policy.evaluator.js'
import type { PolicyConfig, PolicyResult } from '../../core/policy/policy.types.js'
import type { GitHubRepoData } from '../../ports/github.port.js'
import type { Severity } from '../../shared/types.js'

// ── Severity Styling ───────────────────────────────────────────────────────

const SEVERITY_ICON: Record<Severity, string> = {
  critical: chalk.red('✖'),
  warning: chalk.yellow('⚠'),
  info: chalk.blue('ℹ'),
}

const CHECK = chalk.green('✓')
const HEURISTIC_FLAG_KINDS = new Set<FlagKind>([
  'single-maintainer',
  'license-risk',
  'dependency-footprint',
  'missing-repository',
  'version-risk',
])
const STRONG_COPYLEFT_LICENSES = new Set([
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'GPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
])
const RESTRICTED_USE_LICENSES = new Set([
  'BUSL-1.1',
  'CC-BY-NC-4.0',
  'CC-BY-NC-ND-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'Commons-Clause',
  'Elastic-2.0',
  'PolyForm-Noncommercial-1.0.0',
  'Prosperity-3.0.0',
  'SSPL-1.0',
])

interface FormatOptions {
  readonly details?: boolean
}

// ── Inspect Output ─────────────────────────────────────────────────────────

/**
 * Format a single-package analysis for human consumption.
 * Used by: `inspect` and `explain` commands.
 */
export function formatInspect(
  analysis: PackageAnalysis,
  policy: PolicyConfig,
  opts: FormatOptions = {},
): string {
  if (opts.details !== false) {
    return formatInspectDetails(analysis, policy)
  }

  const lines: string[] = []
  const { metadata, downloads, finding } = analysis
  const severityMap = buildSeverityMap(policy)
  const activeFlags = finding?.flags ?? []
  const actionableFlags = sortFlagsBySeverity(
    activeFlags.filter((flag) => getFlagSeverity(flag, severityMap, true) !== 'info'),
    severityMap,
  )
  const heuristicFlags = activeFlags.filter((flag) => HEURISTIC_FLAG_KINDS.has(flag.kind))
  const status =
    actionableFlags.length === 0
      ? CHECK
      : SEVERITY_ICON[findMaxSeverity(actionableFlags, severityMap)]

  lines.push('')
  lines.push(chalk.bold(`${metadata.name}@${metadata.version}`))
  if (metadata.description) {
    lines.push(`  ${chalk.dim(metadata.description)}`)
  }
  lines.push('')
  lines.push(
    `  Verdict: ${status} ${
      actionableFlags.length === 0
        ? 'No actionable findings detected'
        : formatAssessmentLabel(actionableFlags, findMaxSeverity(actionableFlags, severityMap))
    }`,
  )

  if (analysis.vulnQueryFailed) {
    lines.push(`  ${chalk.red('Vulnerability lookup failed; results are incomplete.')}`)
  }

  lines.push(
    `  Quick facts: License ${metadata.license ?? 'unknown'} · Weekly downloads ${formatNumber(downloads?.weekly)} · Last release ${daysSince(metadata.publishedAt)} days ago`,
  )

  if (actionableFlags.length > 0) {
    lines.push('')
    lines.push(formatSectionHeader('Review These Signals'))
    lines.push('')
    for (const flag of actionableFlags.slice(0, 5)) {
      const sev = getFlagSeverity(flag, severityMap, true)
      lines.push(
        `  ${SEVERITY_ICON[sev]} ${FLAG_METADATA[flag.kind].label}: ${formatFlagOneLiner(flag)}`,
      )
    }
  }

  if (heuristicFlags.length > 0) {
    lines.push('')
    lines.push(
      `  ${chalk.dim(`${heuristicFlags.length} heuristic signal${heuristicFlags.length === 1 ? '' : 's'} available with --details.`)}`,
    )
  } else {
    lines.push('')
    lines.push(chalk.dim('  Detailed evidence is shown by default for inspect.'))
  }

  lines.push('')
  return lines.join('\n')
}

function formatInspectDetails(analysis: PackageAnalysis, policy: PolicyConfig): string {
  const lines: string[] = []
  const { metadata, downloads, github, finding } = analysis
  const severityMap = buildSeverityMap(policy)
  const activeFlags = finding?.flags ?? []

  // Header
  lines.push('')
  lines.push(chalk.bold(`${metadata.name}@${metadata.version}`))
  if (metadata.description) {
    lines.push(`  ${chalk.dim(metadata.description)}`)
  }
  if (metadata.repository?.url) {
    lines.push(`  ${chalk.dim(cleanRepoUrl(metadata.repository.url))}`)
  }
  lines.push(
    `  License: ${metadata.license ?? chalk.red('none')} · Weekly downloads: ${formatNumber(downloads?.weekly)}`,
  )

  // Overall assessment
  const maxSeverity = findMaxSeverity(activeFlags, severityMap)
  lines.push('')
  lines.push(
    formatSectionHeader(
      `Assessment: ${formatAssessmentLabel(activeFlags, maxSeverity)}`,
      maxSeverity,
    ),
  )
  lines.push('')

  // Vulnerability query failure warning
  if (analysis.vulnQueryFailed) {
    lines.push(
      `  ${chalk.red.bold('✖ VULNERABILITY DATA UNAVAILABLE')} — query to vulnerability database failed`,
    )
    lines.push(chalk.red('    "No vulnerabilities" below is UNVERIFIED. Do not trust this result.'))
    lines.push('')
  }

  // Flag checklist
  lines.push(...formatFlagChecklist(analysis, activeFlags, severityMap))

  // GitHub section
  if (github) {
    lines.push('')
    lines.push(formatSectionHeader('GitHub Signals'))
    lines.push('')
    lines.push(...formatGitHubSection(github))
  }

  // Waived flags
  if (finding && finding.waived.length > 0) {
    lines.push('')
    lines.push(formatSectionHeader('Waivers'))
    lines.push('')
    for (const waived of finding.waived) {
      lines.push(
        `  ${chalk.dim('~')} ${FLAG_METADATA[waived.flag].label} — ${chalk.dim(waived.reason)}`,
      )
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ── Deep Inspect Output ──────────────────────────────────────────────────────

/**
 * Root package dossier (`inspect`) plus dependency verification summary,
 * red flags, and a combined verdict.
 * Used by: `deep-inspect` command.
 */
export function formatDeepInspect(
  rootAnalysis: PackageAnalysis,
  projectAnalysis: ProjectAnalysis,
  policy: PolicyConfig,
  opts: FormatOptions = {},
): string {
  if (!opts.details) {
    return formatDeepInspectSummary(rootAnalysis, projectAnalysis, policy)
  }

  const lines: string[] = []
  const { metrics, policyResult, treeFlags, scanStats } = projectAnalysis
  const severityMap = buildSeverityMap(policy)
  const rootName = rootAnalysis.metadata.name
  const rootVersion = rootAnalysis.metadata.version

  // ── Header ──
  lines.push('')
  lines.push(chalk.bold(`Deep inspection: ${rootName}@${rootVersion}`))
  lines.push(
    chalk.dim(
      `  Registry-resolved tree · ${metrics.directCount} direct, ${metrics.transitiveCount} transitive · ${metrics.totalPackages} unique packages (max depth ${metrics.maxDepth})`,
    ),
  )
  lines.push('')

  // ── Root package analysis (full inspect block) ──
  const inspectBlock = formatInspectDetails(rootAnalysis, policy)
  lines.push(inspectBlock.trimEnd())

  // ── Dependency Verification Summary ──
  lines.push('')
  lines.push(formatSectionHeader('Dependency Verification'))
  lines.push('')
  lines.push(...formatScanStatsSummary(scanStats, severityMap))

  // ── Vulnerability scan coverage warning ──
  if (scanStats.vulnQueryFailures.length > 0) {
    lines.push('')
    lines.push(
      chalk.red.bold(
        `  ✖ INCOMPLETE VULNERABILITY SCAN — ${scanStats.vulnQueryFailures.length} package(s) could not be checked:`,
      ),
    )
    for (const name of scanStats.vulnQueryFailures) {
      lines.push(chalk.red(`    - ${name}`))
    }
    lines.push(
      chalk.red(
        '    Vulnerability counts below may underreport. Do not treat as a clean bill of health.',
      ),
    )
  }

  // ── Per-Category Verification Checklist ──
  lines.push('')
  lines.push(...formatCategoryVerification(scanStats, policyResult.findings, severityMap))

  // ── Dependency Findings ──
  const otherFindings = policyResult.findings.filter(
    (f) => !(f.name === rootName && f.version === rootVersion),
  )

  const criticalFindings = otherFindings.filter((f) =>
    f.flags.some((fl) => getFlagSeverity(fl, severityMap, f.isDirect) === 'critical'),
  )
  const warningFindings = otherFindings.filter(
    (f) =>
      !f.flags.some((fl) => getFlagSeverity(fl, severityMap, f.isDirect) === 'critical') &&
      f.flags.some((fl) => getFlagSeverity(fl, severityMap, f.isDirect) === 'warning'),
  )

  if (criticalFindings.length > 0 || warningFindings.length > 0) {
    lines.push('')
    lines.push(formatSectionHeader('Red Flags in Dependencies'))
    lines.push('')

    if (criticalFindings.length > 0) {
      for (const f of criticalFindings) {
        const loc = f.isDirect ? 'direct' : `via ${f.introducedBy ?? '?'}`
        lines.push(
          `  ${SEVERITY_ICON.critical} ${chalk.bold(`${f.name}@${f.version}`)} ${chalk.dim(`(${loc})`)}`,
        )
        for (const fl of f.flags) {
          const sev = getFlagSeverity(fl, severityMap, f.isDirect)
          lines.push(
            `    ${SEVERITY_ICON[sev]} ${FLAG_METADATA[fl.kind].label}: ${formatFlagOneLiner(fl)}`,
          )
        }
      }
    }

    if (warningFindings.length > 0) {
      if (criticalFindings.length > 0) lines.push('')
      for (const f of warningFindings) {
        const loc = f.isDirect ? 'direct' : `via ${f.introducedBy ?? '?'}`
        lines.push(
          `  ${SEVERITY_ICON.warning} ${chalk.bold(`${f.name}@${f.version}`)} ${chalk.dim(`(${loc})`)}`,
        )
        for (const fl of f.flags) {
          const sev = getFlagSeverity(fl, severityMap, f.isDirect)
          lines.push(
            `    ${SEVERITY_ICON[sev]} ${FLAG_METADATA[fl.kind].label}: ${formatFlagOneLiner(fl)}`,
          )
        }
      }
    }
  }

  // ── Info-level findings (collapsed) ──
  const infoFindings = otherFindings.filter((f) =>
    f.flags.every((fl) => getFlagSeverity(fl, severityMap, f.isDirect) === 'info'),
  )
  if (infoFindings.length > 0) {
    lines.push('')
    lines.push(
      chalk.blue(
        `  ℹ ${infoFindings.length} package(s) with info-level notes (version lag, missing repo, etc.)`,
      ),
    )
  }

  // ── Dependency tree flags ──
  if (treeFlags.length > 0) {
    lines.push('')
    lines.push(formatSectionHeader('Dependency Tree Shape'))
    lines.push('')
    for (const flag of treeFlags) {
      lines.push(`  ${formatFlagDetail(flag)}`)
    }
  }

  // ── Skipped packages ──
  if (scanStats.skippedPackages > 0) {
    lines.push('')
    lines.push(
      chalk.yellow(
        `  ⚠ ${scanStats.skippedPackages} package(s) could not be verified (metadata fetch failed):`,
      ),
    )
    for (const name of scanStats.skippedNames) {
      lines.push(chalk.yellow(`    - ${name}`))
    }
  }

  // ── Verdict ──
  lines.push('')
  lines.push(formatSectionHeader('Verdict'))
  lines.push('')
  lines.push(
    `  Scanned: ${scanStats.scannedSuccessfully}/${scanStats.totalPackages} packages verified`,
  )
  lines.push(
    `  Findings: ${policyResult.criticalCount} critical · ${policyResult.warningCount} warnings · ${policyResult.infoCount} info`,
  )
  const statusIcon = policyResult.status === 'pass' ? CHECK : chalk.red('✖')
  lines.push(`  Policy: ${statusIcon} ${policyResult.status === 'pass' ? 'PASS' : 'FAIL'}`)
  lines.push('')

  return lines.join('\n')
}

function formatDeepInspectSummary(
  rootAnalysis: PackageAnalysis,
  projectAnalysis: ProjectAnalysis,
  policy: PolicyConfig,
): string {
  const lines: string[] = []
  const { metrics, policyResult } = projectAnalysis
  const severityMap = buildSeverityMap(policy)
  const actionableFindings = sortFindingsBySeverity(
    projectAnalysis.policyResult.findings.filter((finding) =>
      finding.flags.some((flag) => getFlagSeverity(flag, severityMap, finding.isDirect) !== 'info'),
    ),
    severityMap,
  )

  lines.push('')
  lines.push(
    chalk.bold(`Deep inspection: ${rootAnalysis.metadata.name}@${rootAnalysis.metadata.version}`),
  )
  lines.push(
    `  Verdict: ${policyResult.status === 'pass' ? CHECK : chalk.red('✖')} ${policyResult.status === 'pass' ? 'No blocking findings detected' : `${policyResult.criticalCount} critical · ${policyResult.warningCount} warnings`}`,
  )
  lines.push(
    `  Tree: ${metrics.directCount} direct · ${metrics.transitiveCount} transitive · ${metrics.totalPackages} unique packages`,
  )
  lines.push('')
  lines.push(formatSectionHeader('Review These First'))
  lines.push('')

  if (actionableFindings.length === 0) {
    lines.push(`  ${CHECK} No actionable dependency findings detected`)
  } else {
    for (const finding of actionableFindings.slice(0, 5)) {
      lines.push(`  - ${formatConciseFinding(finding, severityMap)}`)
    }
  }

  lines.push('')
  lines.push(
    chalk.dim(
      '  Use --details for root package evidence, verification coverage, and full dependency breakdown.',
    ),
  )
  lines.push('')
  return lines.join('\n')
}

/**
 * Format scan statistics as a human-readable summary block.
 */
function formatScanStatsSummary(
  stats: ScanStatistics,
  _severityMap: Record<FlagKind, Severity>,
): string[] {
  const lines: string[] = []
  const pct =
    stats.totalPackages > 0
      ? Math.round((stats.scannedSuccessfully / stats.totalPackages) * 100)
      : 100

  if (stats.skippedPackages === 0) {
    lines.push(`  ${CHECK} All ${stats.scannedSuccessfully} dependencies scanned successfully`)
  } else {
    lines.push(
      `  ${SEVERITY_ICON.warning} ${stats.scannedSuccessfully}/${stats.totalPackages} dependencies scanned (${pct}% coverage)`,
    )
  }

  lines.push(
    `  ${stats.cleanPackages === stats.scannedSuccessfully ? CHECK : SEVERITY_ICON.warning} ${stats.cleanPackages} clean · ${stats.flaggedPackages} with findings`,
  )

  return lines
}

/**
 * Format per-category verification as a checklist.
 * Shows "checked N, found M" for each flag category.
 */
function formatCategoryVerification(
  stats: ScanStatistics,
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): string[] {
  const lines: string[] = []

  // Group flag kinds by user-facing category
  const categories: { label: string; kinds: FlagKind[]; clean: string }[] = [
    { label: 'Vulnerabilities', kinds: ['vulnerability'], clean: 'No known CVEs (OSV database)' },
    { label: 'Deprecated', kinds: ['deprecated'], clean: 'None marked deprecated by maintainers' },
    {
      label: 'License compliance',
      kinds: ['license-violation', 'license-risk'],
      clean: 'All licenses on the allow list',
    },
    {
      label: 'Install scripts',
      kinds: ['install-scripts'],
      clean: 'No preinstall/postinstall hooks',
    },
    {
      label: 'Maintenance',
      kinds: ['unmaintained', 'single-maintainer'],
      clean: 'Active maintainers, recent publishes',
    },
    {
      label: 'Repository',
      kinds: ['missing-repository'],
      clean: 'All link to reachable GitHub repos',
    },
    {
      label: 'Version currency',
      kinds: ['version-risk'],
      clean: 'All on latest major, stable releases',
    },
  ]

  const scanned = stats.scannedSuccessfully
  const vulnFailCount = stats.vulnQueryFailures.length

  for (const cat of categories) {
    const flagged = cat.kinds.reduce((sum, kind) => sum + (stats.flagCounts[kind] ?? 0), 0)
    const isVuln = cat.kinds.includes('vulnerability')

    if (flagged === 0) {
      if (isVuln && vulnFailCount > 0) {
        const checkedOk = scanned - vulnFailCount
        lines.push(
          `  ${SEVERITY_ICON.warning} ${cat.label.padEnd(22)} ${checkedOk}/${scanned} queried against OSV, ${vulnFailCount} FAILED`,
        )
      } else {
        lines.push(
          `  ${CHECK} ${cat.label.padEnd(22)} ${chalk.dim(`${scanned} checked — ${cat.clean}`)}`,
        )
      }
    } else {
      const maxSev = findings.reduce<Severity>((max, finding) => {
        for (const flag of finding.flags) {
          if (!cat.kinds.includes(flag.kind)) continue
          const sev = getFlagSeverity(flag, severityMap, finding.isDirect)
          if (severityIsAtLeast(sev, max)) {
            max = sev
          }
        }
        return max
      }, 'info')
      const icon = SEVERITY_ICON[maxSev]

      let detail = `${scanned} checked, ${flagged} found`
      if (isVuln && stats.totalVulnerabilities > 0) {
        detail += ` (${stats.totalVulnerabilities} advisories from OSV)`
      }
      if (isVuln && vulnFailCount > 0) {
        detail += chalk.red(` + ${vulnFailCount} FAILED to query`)
      }

      lines.push(`  ${icon} ${cat.label.padEnd(22)} ${detail}`)
    }
  }

  return lines
}

// ── Scan Output ────────────────────────────────────────────────────────────

/**
 * Format a project-wide scan for human consumption.
 * Used by: `scan` command.
 */
export function formatScan(
  analysis: ProjectAnalysis,
  policy: PolicyConfig,
  opts: FormatOptions = {},
): string {
  if (opts.details) {
    return formatScanDetails(analysis, policy)
  }

  const lines: string[] = []
  const severityMap = buildSeverityMap(policy)
  const actionableFindings = sortFindingsBySeverity(
    analysis.policyResult.findings.filter((finding) =>
      finding.flags.some((flag) => getFlagSeverity(flag, severityMap, finding.isDirect) !== 'info'),
    ),
    severityMap,
  )
  const transitiveFindings = actionableFindings.filter((finding) => !finding.isDirect)
  const topFlagCounts = summarizeTopFlagCounts(actionableFindings)
  const directSummaries = summarizeDirectDependencies(analysis, actionableFindings, severityMap)
  const reviewSummaries = directSummaries.slice(0, 5)

  lines.push('')
  lines.push(chalk.bold('Dependency scan'))
  lines.push(
    `  Verdict: ${analysis.policyResult.status === 'pass' ? CHECK : chalk.red('✖')} ${
      analysis.policyResult.status === 'pass'
        ? 'No blocking findings detected'
        : `${analysis.policyResult.criticalCount} critical · ${analysis.policyResult.warningCount} warnings`
    }`,
  )
  lines.push(
    `  Scanned: ${analysis.scanStats.scannedSuccessfully}/${analysis.scanStats.totalPackages} packages · ${analysis.metrics.directCount} direct · ${analysis.metrics.transitiveCount} transitive`,
  )
  lines.push(
    `  Direct dependencies to review: ${directSummaries.length} · Indirect packages with issues: ${transitiveFindings.length}`,
  )

  if (analysis.scanStats.vulnQueryFailures.length > 0) {
    lines.push(
      `  ${chalk.red(`${analysis.scanStats.vulnQueryFailures.length} vulnerability lookup${analysis.scanStats.vulnQueryFailures.length === 1 ? '' : 's'} failed; results are incomplete.`)}`,
    )
  }

  if (topFlagCounts.length > 0) {
    lines.push('')
    lines.push(formatSectionHeader('Most Common Issues'))
    lines.push('')
    for (const summary of topFlagCounts) {
      lines.push(`  - ${summary}`)
    }
  }

  lines.push('')
  lines.push(formatSectionHeader('Review These First'))
  lines.push('')

  if (reviewSummaries.length === 0) {
    lines.push(`  ${CHECK} No actionable dependency findings detected`)
  } else {
    for (const [index, summary] of reviewSummaries.entries()) {
      lines.push(...formatDirectDependencyReviewCard(index + 1, summary))
      lines.push('')
    }
  }

  lines.push(formatSectionHeader('Suggested Next Step'))
  lines.push('')
  lines.push(`  ${formatSuggestedNextStep(reviewSummaries, directSummaries)}`)
  lines.push('')
  lines.push(
    chalk.dim(
      `  +${Math.max(0, directSummaries.length - reviewSummaries.length)} more direct dependencies · use --details for full breakdown`,
    ),
  )
  lines.push('')

  return lines.join('\n')
}

function formatScanDetails(analysis: ProjectAnalysis, policy: PolicyConfig): string {
  const lines: string[] = []
  const { metrics, policyResult, treeFlags } = analysis
  const severityMap = buildSeverityMap(policy)
  const directSummaries = summarizeDirectDependencies(analysis, policyResult.findings, severityMap)
  const transitiveSummary = summarizeTransitiveInfluence(policyResult.findings)
  const topTransitiveRisks = summarizeTopTransitiveRisks(policyResult.findings, severityMap)
  const deprecatedCount = analysis.scanStats.flagCounts.deprecated ?? 0
  const staleCount = analysis.scanStats.flagCounts.unmaintained ?? 0
  const installScriptCount = analysis.scanStats.flagCounts['install-scripts'] ?? 0
  const flaggedTransitives = policyResult.findings.filter((finding) => !finding.isDirect).length
  const staleThreshold = resolveThreshold('unmaintained', policy) ?? 730

  lines.push('')
  lines.push(formatSectionHeader('Dependency Summary'))
  lines.push('')
  lines.push(`  Direct dependencies: ${metrics.directCount} packages you added`)
  lines.push(`  Indirect packages: ${metrics.transitiveCount} pulled in by those dependencies`)
  lines.push('')
  lines.push('  Red flags')
  lines.push(`  - deprecated: ${deprecatedCount}`)
  lines.push(`  - no recent release (>${staleThreshold} days): ${staleCount}`)
  lines.push(`  - run install-time scripts: ${installScriptCount}`)
  lines.push(`  - indirect packages with issues: ${flaggedTransitives}`)
  const statusIcon = policyResult.status === 'pass' ? CHECK : chalk.red('✖')
  lines.push(`  CI status: ${statusIcon} ${policyResult.status === 'pass' ? 'PASS' : 'FAIL'}`)
  lines.push('')

  lines.push(formatSectionHeader('Dependencies You Added'))
  lines.push('')

  if (directSummaries.length === 0) {
    lines.push(`  ${CHECK} No direct dependencies require review`)
    lines.push('')
  } else {
    for (const [index, summary] of directSummaries.entries()) {
      lines.push(`  ${index + 1}. ${chalk.bold(`${summary.name}@${summary.version}`)}`)
      for (const detail of [
        ...summary.directDetails,
        formatTransitiveCount(summary.transitiveCount),
        ...summary.transitiveDetails,
      ].filter(Boolean)) {
        lines.push(`     - ${detail}`)
      }
      lines.push('')
    }
  }

  if (transitiveSummary.length > 0) {
    lines.push(formatSectionHeader('Issues From Indirect Packages'))
    lines.push('')
    for (const detail of transitiveSummary) {
      lines.push(`  - ${detail}`)
    }
    lines.push('')
  }

  if (topTransitiveRisks.length > 0) {
    lines.push(formatSectionHeader('Top Indirect Package Risks'))
    lines.push('')
    for (const [index, risk] of topTransitiveRisks.entries()) {
      lines.push(`  ${index + 1}. ${chalk.bold(`${risk.name}@${risk.version}`)}`)
      for (const detail of risk.details) {
        lines.push(`     - ${detail}`)
      }
      lines.push('')
    }
  }

  if (treeFlags.length > 0) {
    lines.push(formatSectionHeader('Dependency Tree'))
    lines.push('')
    for (const flag of treeFlags) {
      lines.push(`  ${formatFlagDetail(flag)}`)
    }
    lines.push('')
  }

  lines.push(formatSectionHeader('Findings'))
  lines.push('')
  lines.push(
    `  ${policyResult.criticalCount} critical · ${policyResult.warningCount} warnings · ${policyResult.infoCount} info`,
  )
  lines.push('')

  return lines.join('\n')
}

interface DirectDependencySummary {
  readonly name: string
  readonly version: string
  readonly directDetails: readonly string[]
  readonly transitiveDetails: readonly string[]
  readonly transitiveCount: number
  readonly score: number
  readonly directSeverity: Severity
  readonly transitiveSeverity: Severity
}

interface TopTransitiveRiskSummary {
  readonly name: string
  readonly version: string
  readonly details: readonly string[]
  readonly score: number
}

function summarizeDirectDependencies(
  analysis: ProjectAnalysis,
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): DirectDependencySummary[] {
  const directNodes = new Map([...analysis.graph.directDeps()].map(([, node]) => [node.name, node]))
  const findingsByDirect = new Map<
    string,
    { direct?: PackageFinding; transitives: PackageFinding[] }
  >()

  for (const finding of findings) {
    const bucketKey = finding.isDirect ? finding.name : finding.introducedBy
    if (!bucketKey) continue

    const bucket = findingsByDirect.get(bucketKey) ?? { transitives: [] }
    if (finding.isDirect) {
      bucket.direct = finding
    } else {
      bucket.transitives.push(finding)
    }
    findingsByDirect.set(bucketKey, bucket)
  }

  return [...findingsByDirect.entries()]
    .map(([name, bucket]) => {
      const directNode = directNodes.get(name)
      const directFinding = bucket.direct
      const directDetails: string[] = []
      const transitiveDetails: string[] = []

      for (const flag of directFinding?.flags ?? []) {
        directDetails.push(formatScanFlagSummary(flag))
      }

      if (directNode) {
        directDetails.push(directNode.isRuntime ? 'production' : 'dev-only')
      }

      if (bucket.transitives.length > 0) {
        const notable = bucket.transitives
          .slice()
          .sort((a, b) => compareFindingsBySeverity(a, b, severityMap))
          .slice(0, 2)
          .map((finding) => formatScanFindingSummary(finding))

        transitiveDetails.push(...notable)
      }

      return {
        name,
        version: directFinding?.version ?? directNode?.version ?? 'unknown',
        directDetails,
        transitiveDetails,
        transitiveCount: bucket.transitives.length,
        score:
          scoreFindingSet(directFinding?.flags ?? [], severityMap) +
          scoreTransitives(bucket.transitives, severityMap),
        directSeverity: bucket.direct ? getFindingSeverity(bucket.direct, severityMap) : 'info',
        transitiveSeverity: bucket.transitives.reduce<Severity>((highest, finding) => {
          const severity = getFindingSeverity(finding, severityMap)
          if (severity === 'critical') return 'critical'
          if (severity === 'warning' && highest === 'info') return 'warning'
          return highest
        }, 'info'),
      }
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

function summarizeTransitiveInfluence(findings: readonly PackageFinding[]): string[] {
  const transitiveFindings = findings.filter((finding) => !finding.isDirect && finding.introducedBy)
  if (transitiveFindings.length === 0) return []

  const byIntroducer = new Map<string, PackageFinding[]>()
  const deprecatedIntroducers = new Set<string>()
  const installScriptIntroducers = new Set<string>()

  for (const finding of transitiveFindings) {
    const key = finding.introducedBy
    if (!key) continue

    const list = byIntroducer.get(key) ?? []
    list.push(finding)
    byIntroducer.set(key, list)

    if (finding.flags.some((flag) => flag.kind === 'deprecated')) {
      deprecatedIntroducers.add(key)
    }
    if (finding.flags.some((flag) => flag.kind === 'install-scripts')) {
      installScriptIntroducers.add(key)
    }
  }

  return [
    `${byIntroducer.size} direct dependenc${byIntroducer.size === 1 ? 'y introduces' : 'ies introduce'} indirect packages with issues`,
    `${deprecatedIntroducers.size} direct dependenc${deprecatedIntroducers.size === 1 ? 'y introduces' : 'ies introduce'} deprecated indirect packages`,
    `${installScriptIntroducers.size} direct dependenc${installScriptIntroducers.size === 1 ? 'y introduces' : 'ies introduce'} packages that run install-time scripts`,
  ]
}

function summarizeTopTransitiveRisks(
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): TopTransitiveRiskSummary[] {
  const grouped = new Map<string, { finding: PackageFinding; directIntroducers: Set<string> }>()

  for (const finding of findings) {
    if (finding.isDirect) continue
    const key = `${finding.name}@${finding.version}`
    const existing = grouped.get(key) ?? { finding, directIntroducers: new Set<string>() }
    if (finding.introducedBy) {
      existing.directIntroducers.add(finding.introducedBy)
    }
    grouped.set(key, existing)
  }

  return [...grouped.values()]
    .map(({ finding, directIntroducers }) => ({
      name: finding.name,
      version: finding.version,
      details: [
        formatScanFlagsInline(finding.flags),
        `used by ${directIntroducers.size} direct dependenc${directIntroducers.size === 1 ? 'y' : 'ies'}`,
      ],
      score: scoreFindingSet(finding.flags, severityMap) + directIntroducers.size,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5)
}

function formatTransitiveCount(count: number): string {
  return `${count} indirect issue${count === 1 ? '' : 's'}`
}

function formatScanFindingSummary(finding: PackageFinding): string {
  return `${finding.name} (${formatScanFlagsInline(finding.flags)})`
}

function formatScanFlagsInline(flags: readonly Flag[]): string {
  return flags.map((flag) => formatScanFlagSummary(flag)).join(', ')
}

function formatScanFlagSummary(flag: Flag): string {
  switch (flag.kind) {
    case 'deprecated':
      return 'deprecated'
    case 'unmaintained':
      return 'no recent release'
    case 'single-maintainer':
      return 'low maintainer coverage'
    case 'install-scripts':
      return 'runs install-time scripts'
    case 'vulnerability':
      return formatVulnerabilitySummary(flag)
    case 'license-violation':
      return 'license violation'
    case 'license-risk':
      return 'license risk'
    case 'missing-repository':
      return 'missing repository'
    case 'version-risk':
      return 'behind latest release'
    case 'dependency-footprint':
      return `${flag.transitiveCount} transitive deps`
  }
}

function compareFindingsBySeverity(
  a: PackageFinding,
  b: PackageFinding,
  severityMap: Record<FlagKind, Severity>,
): number {
  return (
    scoreFindingSet(b.flags, severityMap, b.isDirect) -
    scoreFindingSet(a.flags, severityMap, a.isDirect)
  )
}

function scoreTransitives(
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): number {
  return findings.reduce(
    (sum, finding) => sum + scoreFindingSet(finding.flags, severityMap, finding.isDirect),
    0,
  )
}

function scoreFindingSet(
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
  isDirect = true,
): number {
  return flags.reduce(
    (sum, flag) => sum + SEVERITY_ORDER[getFlagSeverity(flag, severityMap, isDirect)] + 1,
    0,
  )
}

function sortFlagsBySeverity(
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
  isDirect = true,
): Flag[] {
  return flags.slice().sort((a, b) => {
    const severityDelta =
      SEVERITY_ORDER[getFlagSeverity(b, severityMap, isDirect)] -
      SEVERITY_ORDER[getFlagSeverity(a, severityMap, isDirect)]
    if (severityDelta !== 0) return severityDelta
    return a.kind.localeCompare(b.kind)
  })
}

function sortFindingsBySeverity(
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): PackageFinding[] {
  return findings
    .slice()
    .sort(
      (a, b) =>
        compareFindingsBySeverity(a, b, severityMap) ||
        Number(b.isDirect) - Number(a.isDirect) ||
        a.name.localeCompare(b.name),
    )
}

function formatConciseFinding(
  finding: PackageFinding,
  severityMap: Record<FlagKind, Severity>,
): string {
  const primaryFlags = sortFlagsBySeverity(
    finding.flags.filter((flag) => getFlagSeverity(flag, severityMap, finding.isDirect) !== 'info'),
    severityMap,
    finding.isDirect,
  )
  const location = finding.isDirect
    ? 'direct'
    : `transitive via ${finding.introducedBy ?? 'unknown'}`
  const summaries = primaryFlags.slice(0, 2).map((flag) => {
    const heuristicLabel = HEURISTIC_FLAG_KINDS.has(flag.kind) ? ' (heuristic)' : ''
    return `${FLAG_METADATA[flag.kind].label}${heuristicLabel}: ${formatFlagOneLiner(flag)}`
  })

  return `${finding.name}@${finding.version} [${location}] ${summaries.join(' · ')}`
}

function formatDirectDependencyReviewCard(
  index: number,
  summary: DirectDependencySummary,
): string[] {
  const lines: string[] = []
  const headlineSeverity =
    summary.directSeverity !== 'info' ? summary.directSeverity : summary.transitiveSeverity
  lines.push(
    `  ${index}. ${SEVERITY_ICON[headlineSeverity]} ${chalk.bold(`${summary.name}@${summary.version}`)} ${chalk.dim('(Direct dependency)')}`,
  )
  if (summary.directDetails.length > 0) {
    lines.push(`     direct: ${summary.directDetails.join(' · ')}`)
  }
  if (summary.transitiveCount > 0) {
    const detail =
      summary.transitiveDetails.length > 0
        ? `; e.g. ${summary.transitiveDetails.slice(0, 1).join(' · ')}`
        : ''
    lines.push(
      `     transitive: ${summary.transitiveCount} issue${summary.transitiveCount === 1 ? '' : 's'}${detail}`,
    )
  }
  return lines
}

function formatVulnerabilitySummary(flag: Extract<Flag, { kind: 'vulnerability' }>): string {
  const counts = flag.vulnerabilities.reduce<Record<string, number>>((acc, vulnerability) => {
    acc[vulnerability.severity] = (acc[vulnerability.severity] ?? 0) + 1
    return acc
  }, {})
  const parts = ['critical', 'high', 'medium', 'low']
    .filter((severity) => counts[severity] !== undefined)
    .map((severity) => `${counts[severity]} ${severity}`)

  return `${flag.vulnerabilities.length} known vulnerabilit${flag.vulnerabilities.length === 1 ? 'y' : 'ies'}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`
}

function summarizeTopFlagCounts(findings: readonly PackageFinding[]): string[] {
  const counts = new Map<FlagKind, number>()
  for (const finding of findings) {
    for (const flag of finding.flags) {
      counts.set(flag.kind, (counts.get(flag.kind) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(
      ([kind, count]) =>
        `${count} ${FLAG_METADATA[kind].label.toLowerCase()} finding${count === 1 ? '' : 's'}`,
    )
}

function formatSuggestedNextStep(
  reviewSummaries: readonly DirectDependencySummary[],
  allDirectSummaries: readonly DirectDependencySummary[],
): string {
  const next =
    reviewSummaries.find((summary) => summary.directSeverity === 'critical') ??
    allDirectSummaries.find((summary) => summary.directSeverity === 'critical') ??
    reviewSummaries[0] ??
    allDirectSummaries[0]
  if (next) {
    return `Start with ${next.name}@${next.version}.`
  }

  return 'Review the highest-severity dependencies.'
}

function formatDeniedLicenseMessage(license: string | null): string {
  if (!license) return 'License blocked by policy'

  if (STRONG_COPYLEFT_LICENSES.has(license)) {
    return `${license} (strong copyleft; blocked by policy)`
  }

  if (RESTRICTED_USE_LICENSES.has(license)) {
    return `${license} (usage restrictions or non-open terms; blocked by policy)`
  }

  return `${license} (blocked by policy)`
}

function formatLicenseRiskMessage(license: string, risk: 'uncommon' | 'non-standard'): string {
  if (license === 'CC-BY-4.0') {
    return `${license} (not recommended for software)`
  }

  return `${license} (${risk})`
}
// ── CI Output ──────────────────────────────────────────────────────────────

/**
 * Format CI output — terse, only shows blocking findings.
 * Used by: `ci` command.
 */
export function formatCi(policyResult: PolicyResult, policy: PolicyConfig): string {
  const lines: string[] = []
  const severityMap = buildSeverityMap(policy)

  if (policyResult.status === 'pass') {
    lines.push(`${CHECK} No policy violations found`)
    return lines.join('\n')
  }

  // Only show findings at or above the failOn threshold
  const failOnLevel = policy.ci.failOn
  const blocking = policyResult.findings.filter((f) =>
    f.flags.some((flag) =>
      severityIsAtLeast(getFlagSeverity(flag, severityMap, f.isDirect), failOnLevel),
    ),
  )

  for (const finding of blocking) {
    const location = finding.isDirect
      ? chalk.dim('[direct]')
      : chalk.dim(`[transitive via ${finding.introducedBy ?? 'unknown'}]`)

    lines.push(`${chalk.red('✖')} ${chalk.bold(finding.name)}@${finding.version} ${location}`)

    for (const flag of finding.flags) {
      const severity = getFlagSeverity(flag, severityMap, finding.isDirect)
      if (severityIsAtLeast(severity, failOnLevel)) {
        lines.push(`  ${SEVERITY_ICON[severity]} ${formatFlagOneLiner(flag)}`)
      }
    }
  }

  lines.push('')
  lines.push(`${policyResult.criticalCount} critical · ${policyResult.warningCount} warnings`)
  lines.push(chalk.red.bold(`CI result: FAIL`))

  return lines.join('\n')
}

// ── Internal Helpers ───────────────────────────────────────────────────────

function formatSectionHeader(text: string, severity?: Severity): string {
  const line = '─'.repeat(Math.max(0, 60 - text.length - 4))
  const label = severity ? severityColor(text, severity) : chalk.bold(text)
  return `── ${label} ${chalk.dim(line)}`
}

function formatAssessmentLabel(flags: readonly Flag[], severity: Severity): string {
  if (flags.length === 0) return 'No red flags found'

  switch (severity) {
    case 'critical':
      return 'Needs attention'
    case 'warning':
      return 'Some concerns found'
    case 'info':
      return 'Minor notes only'
  }
}

function formatLicenseSummary(license: string | undefined, flags: readonly Flag[]): string {
  const hasPolicyFlag = flags.some(
    (flag) => flag.kind === 'license-violation' || flag.kind === 'license-risk',
  )
  if (hasPolicyFlag) {
    return license
      ? `${license} · review current policy`
      : 'No license found · review current policy'
  }

  return license ? `${license} · allowed by current policy` : 'No license found'
}

function formatOwnershipSummary(maintainerCount: number): string {
  return maintainerCount === 1
    ? '1 listed npm maintainer'
    : `${maintainerCount} listed npm maintainers`
}

function formatRepositorySummary(
  metadata: PackageAnalysis['metadata'],
  github: PackageAnalysis['github'],
): string {
  if (github) {
    return `GitHub repo found · reachable · archived: ${github.isArchived ? 'yes' : 'no'}`
  }

  if (metadata.repository?.url) {
    return 'Repository link found'
  }

  return 'No repository link found'
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
}

function formatFlagChecklist(
  analysis: PackageAnalysis,
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
): string[] {
  const lines: string[] = []
  const { metadata, github } = analysis
  const dependencyCount = Object.keys(metadata.dependencies ?? {}).length

  const categories: { label: string; kinds?: FlagKind[]; render: () => string }[] = [
    {
      label: 'Vulnerabilities',
      kinds: ['vulnerability'],
      render: () => 'No known advisories found in OSV',
    },
    {
      label: 'License',
      kinds: ['license-violation', 'license-risk'],
      render: () => formatLicenseSummary(metadata.license, flags),
    },
    {
      label: 'Install scripts',
      kinds: ['install-scripts'],
      render: () => 'None detected',
    },
    {
      label: 'Maintenance',
      kinds: ['unmaintained', 'deprecated'],
      render: () => `Last release: ${daysSince(metadata.publishedAt)} days ago · not deprecated`,
    },
    {
      label: 'Ownership',
      kinds: ['single-maintainer'],
      render: () => formatOwnershipSummary(metadata.maintainers.length),
    },
    {
      label: 'Repository',
      kinds: ['missing-repository'],
      render: () => formatRepositorySummary(metadata, github),
    },
    {
      label: 'Version',
      kinds: ['version-risk'],
      render: () => `Installed: ${metadata.version} · Latest: ${metadata.latestVersion}`,
    },
    {
      label: 'Dependencies',
      render: () =>
        `${dependencyCount} direct runtime dependenc${dependencyCount === 1 ? 'y' : 'ies'}`,
    },
  ]

  for (const cat of categories) {
    const kinds = cat.kinds
    const matching = kinds ? flags.filter((f) => kinds.includes(f.kind)) : []
    if (matching.length > 0) {
      for (const flag of matching) {
        const sev = getFlagSeverity(flag, severityMap, true)
        lines.push(`  ${SEVERITY_ICON[sev]} ${cat.label.padEnd(20)} ${formatFlagOneLiner(flag)}`)
      }
    } else {
      lines.push(`  ${CHECK} ${cat.label.padEnd(20)} ${chalk.dim(cat.render())}`)
    }
  }

  return lines
}

function formatFlagOneLiner(flag: Flag): string {
  switch (flag.kind) {
    case 'vulnerability': {
      const counts = flag.vulnerabilities.reduce<Record<string, number>>((acc, v) => {
        acc[v.severity] = (acc[v.severity] ?? 0) + 1
        return acc
      }, {})
      const parts = Object.entries(counts).map(([sev, count]) => `${count} ${sev}`)
      return `${flag.vulnerabilities.length} known (${parts.join(', ')})`
    }
    case 'deprecated':
      return flag.reason
    case 'license-violation':
      return flag.violation === 'missing'
        ? 'No license specified'
        : flag.violation === 'denied'
          ? formatDeniedLicenseMessage(flag.license)
          : `${flag.license} (not in the approved software-license list)`
    case 'license-risk':
      return formatLicenseRiskMessage(flag.license, flag.risk)
    case 'install-scripts':
      return `${flag.scripts.join(', ')} hooks`
    case 'unmaintained': {
      const parts = [`Last release ${flag.daysSincePublish} days ago`]
      if (flag.isArchived) parts.push('repo archived')
      if (flag.commitsLast12Months !== undefined)
        parts.push(`${flag.commitsLast12Months} commits/12mo`)
      return parts.join(', ')
    }
    case 'single-maintainer': {
      const parts = [`${flag.npmMaintainerCount} npm maintainer`]
      if (flag.githubContributorCount !== undefined) {
        parts.push(`${flag.githubContributorCount} contributors`)
      }
      return parts.join(', ')
    }
    case 'dependency-footprint':
      return `${flag.transitiveCount} transitives (${flag.uniqueCount} unique, ${flag.duplicatedCount} duplicated, depth ${flag.maxDepth})`
    case 'missing-repository':
      return flag.reason === 'no-field'
        ? 'No repository field'
        : flag.reason === 'not-github'
          ? 'Not a GitHub repository'
          : 'Repository returns 404'
    case 'version-risk':
      return flag.issue === 'prerelease'
        ? `Using prerelease ${flag.currentVersion} (latest: ${flag.latestVersion})`
        : `${flag.majorVersionsBehind} major versions behind (${flag.currentVersion} → ${flag.latestVersion})`
  }
}

function formatFlagDetail(flag: Flag): string {
  const meta = FLAG_METADATA[flag.kind]
  return `${meta.label}: ${formatFlagOneLiner(flag)}`
}

function formatGitHubSection(github: GitHubRepoData): string[] {
  const lines: string[] = []

  const daysSinceCommit = Math.floor(
    (Date.now() - github.lastCommitDate.getTime()) / (1000 * 60 * 60 * 24),
  )
  lines.push(
    `  Stars: ${formatNumber(github.stars)} · Forks: ${formatNumber(github.forks)} · Contributors: ${github.contributorCount}`,
  )
  lines.push(
    `  Last commit: ${daysSinceCommit} days ago · Open issues: ${github.openIssues} · Archived: ${github.isArchived ? 'Yes' : 'No'}`,
  )

  return lines
}

function findMaxSeverity(
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
  isDirect = true,
): Severity {
  if (flags.length === 0) return 'info'
  let max: Severity = 'info'
  for (const flag of flags) {
    const sev = getFlagSeverity(flag, severityMap, isDirect)
    if (sev === 'critical') return 'critical'
    if (sev === 'warning') max = 'warning'
  }
  return max
}

const SEVERITY_ORDER: Record<Severity, number> = { info: 0, warning: 1, critical: 2 }

function severityIsAtLeast(actual: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[actual] >= SEVERITY_ORDER[threshold]
}

function severityColor(text: string, severity: Severity): string {
  switch (severity) {
    case 'critical':
      return chalk.red.bold(text)
    case 'warning':
      return chalk.yellow.bold(text)
    case 'info':
      return chalk.blue(text)
  }
}

function formatNumber(n: number | undefined): string {
  if (n === undefined) return chalk.dim('n/a')
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function cleanRepoUrl(url: string): string {
  return url
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^ssh:\/\/git@/, 'https://')
}

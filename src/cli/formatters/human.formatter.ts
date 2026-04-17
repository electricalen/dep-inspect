import chalk from 'chalk'

import type { PackageAnalysis } from '../../core/analysis/package.analyzer.js'
import type { ProjectAnalysis, ScanStatistics } from '../../core/analysis/project.analyzer.js'
import { FLAG_METADATA } from '../../core/flags/flag.registry.js'
import type { Flag, FlagKind, PackageFinding } from '../../core/flags/flag.types.js'
import { buildSeverityMap, resolveThreshold } from '../../core/policy/policy.evaluator.js'
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
    activeFlags.filter((flag) => severityMap[flag.kind] !== 'info'),
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
      const sev = severityMap[flag.kind]
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
  lines.push(...formatCategoryVerification(scanStats, severityMap))

  // ── Red Flags (critical + warnings in transitive deps) ──
  const otherFindings = policyResult.findings.filter(
    (f) => !(f.name === rootName && f.version === rootVersion),
  )

  const criticalFindings = otherFindings.filter((f) =>
    f.flags.some((fl) => severityMap[fl.kind] === 'critical'),
  )
  const warningFindings = otherFindings.filter(
    (f) =>
      !f.flags.some((fl) => severityMap[fl.kind] === 'critical') &&
      f.flags.some((fl) => severityMap[fl.kind] === 'warning'),
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
          const sev = severityMap[fl.kind]
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
          const sev = severityMap[fl.kind]
          lines.push(
            `    ${SEVERITY_ICON[sev]} ${FLAG_METADATA[fl.kind].label}: ${formatFlagOneLiner(fl)}`,
          )
        }
      }
    }
  }

  // ── Info-level findings (collapsed) ──
  const infoFindings = otherFindings.filter((f) =>
    f.flags.every((fl) => severityMap[fl.kind] === 'info'),
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
      finding.flags.some((flag) => severityMap[flag.kind] !== 'info'),
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
      const maxSev = cat.kinds.reduce<Severity>((max, kind) => {
        if ((stats.flagCounts[kind] ?? 0) > 0) {
          const sev = severityMap[kind]
          if (severityIsAtLeast(sev, max)) return sev
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
      finding.flags.some((flag) => severityMap[flag.kind] !== 'info'),
    ),
    severityMap,
  )
  const directFindings = actionableFindings.filter((finding) => finding.isDirect)
  const transitiveFindings = actionableFindings.filter((finding) => !finding.isDirect)
  const topFlagCounts = summarizeTopFlagCounts(actionableFindings)
  const reviewFindings = selectReviewFindings(actionableFindings, severityMap)

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
    `  Packages with findings: ${directFindings.length} direct · ${transitiveFindings.length} transitive`,
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

  if (actionableFindings.length === 0) {
    lines.push(`  ${CHECK} No actionable dependency findings detected`)
  } else {
    for (const [index, finding] of reviewFindings.entries()) {
      lines.push(...formatScanReviewCard(index + 1, finding, severityMap))
      lines.push('')
    }
  }

  lines.push(formatSectionHeader('Suggested Next Step'))
  lines.push('')
  lines.push(`  ${formatSuggestedNextStep(actionableFindings, severityMap)}`)
  lines.push('')
  lines.push(
    `  More to review: ${Math.max(0, directFindings.length - 3)} additional direct · ${Math.max(0, transitiveFindings.length - Math.max(0, 5 - Math.min(3, directFindings.length)))} additional transitive`,
  )
  lines.push(chalk.dim('  Use --details for the full package-by-package breakdown.'))
  lines.push('')

  return lines.join('\n')
}

function formatScanDetails(analysis: ProjectAnalysis, policy: PolicyConfig): string {
  const lines: string[] = []
  const { metrics, policyResult, treeFlags } = analysis
  const severityMap = buildSeverityMap(policy)
  const directSummaries = summarizeDirectDependencies(analysis, severityMap)
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
      for (const detail of summary.details) {
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
  readonly details: readonly string[]
  readonly score: number
}

interface TopTransitiveRiskSummary {
  readonly name: string
  readonly version: string
  readonly details: readonly string[]
  readonly score: number
}

function summarizeDirectDependencies(
  analysis: ProjectAnalysis,
  severityMap: Record<FlagKind, Severity>,
): DirectDependencySummary[] {
  const directNodes = new Map([...analysis.graph.directDeps()].map(([, node]) => [node.name, node]))
  const findingsByDirect = new Map<
    string,
    { direct?: PackageFinding; transitives: PackageFinding[] }
  >()

  for (const finding of analysis.policyResult.findings) {
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
      const details: string[] = []

      for (const flag of directFinding?.flags ?? []) {
        details.push(formatScanFlagSummary(flag))
      }

      if (directNode) {
        details.push(directNode.isRuntime ? 'used in production' : 'development-only dependency')
      }

      if (bucket.transitives.length > 0) {
        details.push(formatTransitiveCount(bucket.transitives.length))

        const notable = bucket.transitives
          .slice()
          .sort((a, b) => compareFindingsBySeverity(a, b, severityMap))
          .slice(0, 2)
          .map((finding) => `includes ${formatScanFindingSummary(finding)}`)

        details.push(...notable)
      }

      return {
        name,
        version: directFinding?.version ?? directNode?.version ?? 'unknown',
        details,
        score:
          scoreFindingSet(directFinding?.flags ?? [], severityMap) +
          scoreTransitives(bucket.transitives, severityMap),
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
  return `${count} indirect package${count === 1 ? '' : 's'} with issues`
}

function formatScanFindingSummary(finding: PackageFinding): string {
  return `${formatScanFlagsInline(finding.flags)} package: ${finding.name}`
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
      return `${flag.vulnerabilities.length} known vulnerabilities`
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
  return scoreFindingSet(b.flags, severityMap) - scoreFindingSet(a.flags, severityMap)
}

function scoreTransitives(
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): number {
  return findings.reduce((sum, finding) => sum + scoreFindingSet(finding.flags, severityMap), 0)
}

function scoreFindingSet(flags: readonly Flag[], severityMap: Record<FlagKind, Severity>): number {
  return flags.reduce((sum, flag) => sum + SEVERITY_ORDER[severityMap[flag.kind]] + 1, 0)
}

function sortFlagsBySeverity(
  flags: readonly Flag[],
  severityMap: Record<FlagKind, Severity>,
): Flag[] {
  return flags.slice().sort((a, b) => {
    const severityDelta = SEVERITY_ORDER[severityMap[b.kind]] - SEVERITY_ORDER[severityMap[a.kind]]
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
    finding.flags.filter((flag) => severityMap[flag.kind] !== 'info'),
    severityMap,
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

function formatScanReviewCard(
  index: number,
  finding: PackageFinding,
  severityMap: Record<FlagKind, Severity>,
): string[] {
  const lines: string[] = []
  const primaryFlags = sortFlagsBySeverity(
    finding.flags.filter((flag) => severityMap[flag.kind] !== 'info'),
    severityMap,
  )
  const highestSeverity = findMaxSeverity(primaryFlags, severityMap)
  const location = finding.isDirect
    ? 'Direct dependency'
    : finding.introducedBy
      ? `Transitive via ${finding.introducedBy}`
      : 'Transitive dependency'

  lines.push(
    `  ${index}. ${SEVERITY_ICON[highestSeverity]} ${chalk.bold(`${finding.name}@${finding.version}`)} ${chalk.dim(`(${location})`)}`,
  )
  lines.push(`     Why: ${primaryFlags.slice(0, 2).map(formatActionableFlagSummary).join(' · ')}`)
  lines.push(`     Action: ${formatActionHint(primaryFlags)}`)

  return lines
}

function formatActionableFlagSummary(flag: Flag): string {
  switch (flag.kind) {
    case 'vulnerability':
      return `${flag.vulnerabilities.length} known vulnerabilit${flag.vulnerabilities.length === 1 ? 'y' : 'ies'}`
    case 'deprecated':
      return 'deprecated by maintainer'
    case 'license-violation':
      return flag.violation === 'denied'
        ? formatDeniedLicenseSummary(flag.license)
        : flag.violation === 'unknown'
          ? `${flag.license ?? 'license'} not in the approved software-license list`
          : 'missing license metadata'
    case 'install-scripts':
      return `${flag.scripts.join(', ')} install hook${flag.scripts.length === 1 ? '' : 's'}`
    case 'unmaintained':
      return `last release ${flag.daysSincePublish} days ago${flag.isArchived ? ' and repo archived' : ''}`
    case 'single-maintainer':
      return `${flag.npmMaintainerCount} listed maintainer`
    case 'license-risk':
      return formatLicenseRiskSummary(flag.license, flag.risk)
    case 'missing-repository':
      return 'repository metadata missing'
    case 'version-risk':
      return flag.issue === 'prerelease'
        ? `using prerelease ${flag.currentVersion}`
        : `${flag.majorVersionsBehind ?? 0} major versions behind`
    case 'dependency-footprint':
      return `${flag.transitiveCount} transitive dependencies`
  }
}

function formatActionHint(flags: readonly Flag[]): string {
  if (flags.some((flag) => flag.kind === 'vulnerability')) {
    return 'Upgrade or replace this package, then re-run the scan.'
  }
  if (flags.some((flag) => flag.kind === 'deprecated')) {
    return 'Plan an upgrade or replacement; maintainers no longer support this package.'
  }
  if (flags.some((flag) => flag.kind === 'license-violation')) {
    return 'Review your license policy and replace or waive this dependency if needed.'
  }
  if (flags.some((flag) => flag.kind === 'install-scripts')) {
    return 'Audit the install script and confirm the package is trusted before keeping it.'
  }
  if (flags.some((flag) => flag.kind === 'unmaintained')) {
    return 'Check whether a maintained alternative or newer package line is available.'
  }

  return 'Inspect this package in detail before accepting it into the dependency tree.'
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
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): string {
  const directCritical = findings.find(
    (finding) =>
      finding.isDirect && finding.flags.some((flag) => severityMap[flag.kind] === 'critical'),
  )
  if (directCritical) {
    return `Start with ${directCritical.name}@${directCritical.version}; it is a direct dependency with blocking findings.`
  }

  const transitiveCritical = findings.find((finding) =>
    finding.flags.some((flag) => severityMap[flag.kind] === 'critical'),
  )
  if (transitiveCritical) {
    return transitiveCritical.introducedBy
      ? `Inspect ${transitiveCritical.introducedBy}; it pulls in a transitive package with blocking findings.`
      : `Inspect ${transitiveCritical.name}@${transitiveCritical.version}; it has blocking findings and no direct introducer could be resolved.`
  }

  const directWarning = findings.find((finding) => finding.isDirect)
  if (directWarning) {
    return `Start with ${directWarning.name}@${directWarning.version}; it is a direct dependency with warning-level findings.`
  }

  return 'Review the highest-severity transitive packages, then open --details for the full dependency breakdown.'
}

function selectReviewFindings(
  findings: readonly PackageFinding[],
  severityMap: Record<FlagKind, Severity>,
): PackageFinding[] {
  if (findings.length <= 5) return findings.slice()

  const directCritical = findings.find(
    (finding) =>
      finding.isDirect && finding.flags.some((flag) => severityMap[flag.kind] === 'critical'),
  )
  if (!directCritical) {
    return findings.slice(0, 5)
  }

  const topFindings = findings.slice(0, 5)
  if (
    topFindings.some(
      (finding) =>
        finding.name === directCritical.name && finding.version === directCritical.version,
    )
  ) {
    return topFindings
  }

  return [directCritical, ...findings.filter((finding) => finding !== directCritical).slice(0, 4)]
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

function formatDeniedLicenseSummary(license: string | null): string {
  if (!license) return 'license blocked by policy'

  if (STRONG_COPYLEFT_LICENSES.has(license)) {
    return `${license} blocked by policy (strong copyleft)`
  }

  if (RESTRICTED_USE_LICENSES.has(license)) {
    return `${license} blocked by policy (usage restrictions or non-open terms)`
  }

  return `${license} blocked by policy`
}

function formatLicenseRiskMessage(license: string, risk: 'uncommon' | 'non-standard'): string {
  if (license === 'CC-BY-4.0') {
    return `${license} (not recommended for software)`
  }

  return `${license} (${risk})`
}

function formatLicenseRiskSummary(license: string, risk: 'uncommon' | 'non-standard'): string {
  if (license === 'CC-BY-4.0') {
    return `${license} is not recommended for software`
  }

  return risk === 'uncommon' ? `${license} needs license review` : `${license} license risk`
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
    f.flags.some((flag) => severityIsAtLeast(severityMap[flag.kind], failOnLevel)),
  )

  for (const finding of blocking) {
    const location = finding.isDirect
      ? chalk.dim('[direct]')
      : chalk.dim(`[transitive via ${finding.introducedBy ?? 'unknown'}]`)

    lines.push(`${chalk.red('✖')} ${chalk.bold(finding.name)}@${finding.version} ${location}`)

    for (const flag of finding.flags) {
      if (severityIsAtLeast(severityMap[flag.kind], failOnLevel)) {
        lines.push(`  ${SEVERITY_ICON[severityMap[flag.kind]]} ${formatFlagOneLiner(flag)}`)
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
        const sev = severityMap[flag.kind]
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

import type { Severity } from '../../shared/types.js'
import { buildDefaultSeverityMap } from '../flags/flag.registry.js'
import type { Flag, FlagKind, PackageFinding, WaivedFlag } from '../flags/flag.types.js'
import type { PolicyConfig, PolicyResult } from './policy.types.js'

const SEVERITY_ORDER: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
}

/**
 * Resolve the effective severity for a flag kind from policy config.
 * Returns null if the flag is disabled ('off').
 */
function resolveEffectiveSeverity(
  kind: FlagKind,
  config: PolicyConfig,
  defaults: Record<FlagKind, Severity>,
): Severity | null {
  const rule = config.severity[kind]

  if (rule === undefined) {
    return defaults[kind]
  }

  if (typeof rule === 'string') {
    return rule === 'off' ? null : rule
  }

  return rule.level === 'off' ? null : rule.level
}

/**
 * Get the threshold for a flag (e.g., thresholdDays for unmaintained).
 */
export function resolveThreshold(kind: FlagKind, config: PolicyConfig): number | undefined {
  const rule = config.severity[kind]
  if (rule !== undefined && typeof rule === 'object') {
    return rule.thresholdDays
  }
  return undefined
}

/**
 * Check if a waiver applies to a package/flag combination.
 * Returns the waiver reason if applicable, null otherwise.
 */
function findWaiver(packageName: string, flagKind: FlagKind, config: PolicyConfig): string | null {
  for (const waiver of config.waivers) {
    if (waiver.package !== packageName || waiver.flag !== flagKind) continue

    // Check expiry
    if (waiver.expires) {
      const expiryDate = new Date(waiver.expires)
      if (expiryDate < new Date()) continue // Expired waiver
    }

    return waiver.reason
  }

  return null
}

/** Build a severity map from policy config, merging with defaults. */
export function buildSeverityMap(config: PolicyConfig): Record<FlagKind, Severity> {
  const defaults = buildDefaultSeverityMap()
  const map = { ...defaults }

  for (const kind of Object.keys(defaults) as FlagKind[]) {
    const resolved = resolveEffectiveSeverity(kind, config, defaults)
    if (resolved !== null) {
      map[kind] = resolved
    }
  }

  return map
}

function minSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b
}

function resolveVulnerabilitySeverity(
  flag: Extract<Flag, { kind: 'vulnerability' }>,
  isDirect: boolean,
) {
  const highestAdvisory = flag.vulnerabilities.reduce<'critical' | 'high' | 'medium' | 'low'>(
    (highest, advisory) =>
      advisory.severity === 'critical' ||
      (highest !== 'critical' &&
        (advisory.severity === 'high' || (highest === 'low' && advisory.severity === 'medium')))
        ? advisory.severity
        : highest,
    'low',
  )

  switch (highestAdvisory) {
    case 'critical':
    case 'high':
      return 'critical' as const
    case 'medium':
      return 'warning' as const
    case 'low':
      return isDirect ? ('warning' as const) : ('info' as const)
  }
}

/** Resolve the effective severity for an individual flag within a finding. */
export function getFlagSeverity(
  flag: Flag,
  severityMap: Record<FlagKind, Severity>,
  isDirect: boolean,
): Severity {
  const baseSeverity =
    flag.kind !== 'vulnerability'
      ? severityMap[flag.kind]
      : minSeverity(resolveVulnerabilitySeverity(flag, isDirect), severityMap.vulnerability)

  // Transitive findings are review signals, not blockers.
  if (!isDirect) {
    return minSeverity(baseSeverity, 'warning')
  }

  return baseSeverity
}

/** Resolve the effective severity for a finding from its active flags. */
export function getFindingSeverity(
  finding: Pick<PackageFinding, 'flags' | 'isDirect'>,
  severityMap: Record<FlagKind, Severity>,
): Severity {
  let highest: Severity = 'info'
  for (const flag of finding.flags) {
    const severity = getFlagSeverity(flag, severityMap, finding.isDirect)
    if (severity === 'critical') return 'critical'
    if (severity === 'warning') highest = 'warning'
  }
  return highest
}

/**
 * Apply policy to raw flags for a single package.
 * Filters out disabled flags, applies waivers, and classifies severity.
 *
 * This is a pure function — no I/O.
 */
export function applyPolicyToPackage(
  packageName: string,
  flags: readonly Flag[],
  config: PolicyConfig,
  isDirect: boolean,
  isRuntime: boolean,
  introducedBy?: string,
): PackageFinding | null {
  const defaults = buildDefaultSeverityMap()
  const activeFlags: Flag[] = []
  const waivedFlags: WaivedFlag[] = []

  for (const flag of flags) {
    const severity = resolveEffectiveSeverity(flag.kind, config, defaults)

    // Skip disabled flags
    if (severity === null) continue

    // Check for waiver
    const waiverReason = findWaiver(packageName, flag.kind, config)
    if (waiverReason !== null) {
      waivedFlags.push({ flag: flag.kind, reason: waiverReason })
      continue
    }

    activeFlags.push(flag)
  }

  // Skip packages with no active flags
  if (activeFlags.length === 0 && waivedFlags.length === 0) return null

  return {
    name: packageName as import('../../shared/types.js').PackageName,
    version: '', // Filled in by the caller
    flags: activeFlags,
    isDirect,
    isRuntime,
    introducedBy: introducedBy as import('../../shared/types.js').PackageName | undefined,
    waived: waivedFlags,
  }
}

/**
 * Evaluate policy across all package findings.
 * Determines pass/fail based on the CI failOn severity.
 *
 * This is a pure function — no I/O.
 */
export function evaluatePolicy(
  findings: readonly PackageFinding[],
  config: PolicyConfig,
): PolicyResult {
  const severityMap = buildSeverityMap(config)
  const failOnLevel = SEVERITY_ORDER[config.ci.failOn]

  let criticalCount = 0
  let warningCount = 0
  let infoCount = 0
  let shouldFail = false

  for (const finding of findings) {
    for (const flag of finding.flags) {
      const severity = getFlagSeverity(flag, severityMap, finding.isDirect)
      switch (severity) {
        case 'critical':
          criticalCount++
          break
        case 'warning':
          warningCount++
          break
        case 'info':
          infoCount++
          break
      }

      if (SEVERITY_ORDER[severity] >= failOnLevel) {
        shouldFail = true
      }
    }
  }

  return {
    findings,
    status: shouldFail ? 'fail' : 'pass',
    criticalCount,
    warningCount,
    infoCount,
  }
}

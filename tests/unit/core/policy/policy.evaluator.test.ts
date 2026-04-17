import { describe, expect, it } from 'vitest'

import {
  applyPolicyToPackage,
  getFlagSeverity,
  evaluatePolicy,
  buildSeverityMap,
} from '../../../../src/core/policy/policy.evaluator.js'
import type { PolicyConfig } from '../../../../src/core/policy/policy.types.js'
import type { Flag, PackageFinding } from '../../../../src/core/flags/flag.types.js'
import { DEFAULT_POLICY } from '../../../../src/config/config.defaults.js'
import type { PackageName } from '../../../../src/shared/types.js'

const pkg = (name: string) => name as PackageName

function finding(name: string, flags: readonly Flag[], isDirect = true): PackageFinding {
  return {
    name: pkg(name),
    version: '1.0.0',
    flags,
    isDirect,
    isRuntime: true,
    waived: [],
  }
}

describe('buildSeverityMap', () => {
  it('uses defaults when no overrides provided', () => {
    const map = buildSeverityMap(DEFAULT_POLICY)
    expect(map.vulnerability).toBe('critical')
    expect(map['install-scripts']).toBe('warning')
    expect(map['missing-repository']).toBe('info')
  })

  it('applies severity overrides', () => {
    const config: PolicyConfig = {
      ...DEFAULT_POLICY,
      severity: { 'install-scripts': 'critical' },
    }
    const map = buildSeverityMap(config)
    expect(map['install-scripts']).toBe('critical')
  })
})

describe('applyPolicyToPackage', () => {
  it('returns null when no flags are active', () => {
    const result = applyPolicyToPackage('lodash', [], DEFAULT_POLICY, true, true)
    expect(result).toBeNull()
  })

  it('filters out disabled flags', () => {
    const config: PolicyConfig = {
      ...DEFAULT_POLICY,
      severity: { 'install-scripts': 'off' },
    }
    const flags: Flag[] = [{ kind: 'install-scripts', scripts: ['postinstall'] }]
    const result = applyPolicyToPackage('pkg', flags, config, true, true)
    expect(result).toBeNull()
  })

  it('applies waivers', () => {
    const config: PolicyConfig = {
      ...DEFAULT_POLICY,
      waivers: [{ package: 'sharp', flag: 'install-scripts', reason: 'approved native dep' }],
    }
    const flags: Flag[] = [{ kind: 'install-scripts', scripts: ['postinstall'] }]
    const result = applyPolicyToPackage('sharp', flags, config, true, true)
    expect(result).not.toBeNull()
    expect(result!.flags).toHaveLength(0)
    expect(result!.waived).toHaveLength(1)
    expect(result!.waived[0]!.reason).toBe('approved native dep')
  })

  it('does not apply expired waivers', () => {
    const config: PolicyConfig = {
      ...DEFAULT_POLICY,
      waivers: [
        { package: 'sharp', flag: 'install-scripts', reason: 'old', expires: '2020-01-01' },
      ],
    }
    const flags: Flag[] = [{ kind: 'install-scripts', scripts: ['postinstall'] }]
    const result = applyPolicyToPackage('sharp', flags, config, true, true)
    expect(result!.flags).toHaveLength(1)
    expect(result!.waived).toHaveLength(0)
  })

  it('keeps active flags that are not waived', () => {
    const flags: Flag[] = [
      { kind: 'deprecated', reason: 'use something else' },
      { kind: 'install-scripts', scripts: ['postinstall'] },
    ]
    const result = applyPolicyToPackage('old-pkg', flags, DEFAULT_POLICY, true, true)
    expect(result!.flags).toHaveLength(2)
  })
})

describe('evaluatePolicy', () => {
  it('passes when no findings', () => {
    const result = evaluatePolicy([], DEFAULT_POLICY)
    expect(result.status).toBe('pass')
    expect(result.criticalCount).toBe(0)
  })

  it('fails when critical findings exist and failOn is critical', () => {
    const findings: PackageFinding[] = [
      finding('old-pkg', [{ kind: 'deprecated', reason: 'use new-pkg' }]),
    ]
    const result = evaluatePolicy(findings, DEFAULT_POLICY)
    expect(result.status).toBe('fail')
    expect(result.criticalCount).toBe(1)
  })

  it('passes when only info findings and failOn is critical', () => {
    const findings: PackageFinding[] = [
      finding('pkg', [{ kind: 'missing-repository', reason: 'no-field' }]),
    ]
    const result = evaluatePolicy(findings, DEFAULT_POLICY)
    expect(result.status).toBe('pass')
    expect(result.infoCount).toBe(1)
  })

  it('fails when warning findings exist and failOn is warning', () => {
    const config: PolicyConfig = {
      ...DEFAULT_POLICY,
      ci: { failOn: 'warning' },
    }
    const findings: PackageFinding[] = [
      finding('pkg', [{ kind: 'install-scripts', scripts: ['postinstall'] }]),
    ]
    const result = evaluatePolicy(findings, config)
    expect(result.status).toBe('fail')
    expect(result.warningCount).toBe(1)
  })

  it('counts findings by severity', () => {
    const findings: PackageFinding[] = [
      finding('a', [{ kind: 'deprecated', reason: 'old' }]),
      finding('b', [
        { kind: 'install-scripts', scripts: ['postinstall'] },
        { kind: 'missing-repository', reason: 'no-field' },
      ]),
    ]
    const result = evaluatePolicy(findings, DEFAULT_POLICY)
    expect(result.criticalCount).toBe(1)
    expect(result.warningCount).toBe(1)
    expect(result.infoCount).toBe(1)
  })

  it('downgrades medium vulnerabilities to warnings', () => {
    const severityMap = buildSeverityMap(DEFAULT_POLICY)
    const severity = getFlagSeverity(
      {
        kind: 'vulnerability',
        vulnerabilities: [
          {
            id: 'OSV-1',
            severity: 'medium',
            summary: 'medium issue',
            fixAvailable: true,
          },
        ],
      },
      severityMap,
      true,
    )

    expect(severity).toBe('warning')
  })

  it('downgrades low transitive vulnerabilities to info', () => {
    const severityMap = buildSeverityMap(DEFAULT_POLICY)
    const severity = getFlagSeverity(
      {
        kind: 'vulnerability',
        vulnerabilities: [
          {
            id: 'OSV-LOW',
            severity: 'low',
            summary: 'low issue',
            fixAvailable: false,
          },
        ],
      },
      severityMap,
      false,
    )

    expect(severity).toBe('info')
  })

  it('caps transitive deprecated findings at warning', () => {
    const severityMap = buildSeverityMap(DEFAULT_POLICY)
    const severity = getFlagSeverity(
      { kind: 'deprecated', reason: 'deprecated transitive' },
      severityMap,
      false,
    )

    expect(severity).toBe('warning')
  })

  it('does not fail on transitive-only critical defaults when failOn is critical', () => {
    const findings: PackageFinding[] = [
      {
        name: pkg('transitive-pkg'),
        version: '1.0.0',
        flags: [{ kind: 'deprecated', reason: 'deprecated transitive' }],
        isDirect: false,
        isRuntime: true,
        introducedBy: pkg('direct-pkg'),
        waived: [],
      },
    ]

    const result = evaluatePolicy(findings, DEFAULT_POLICY)
    expect(result.status).toBe('pass')
    expect(result.criticalCount).toBe(0)
    expect(result.warningCount).toBe(1)
  })
})

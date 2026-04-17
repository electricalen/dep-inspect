import { describe, expect, it } from 'vitest'

import { detectLicenseIssues } from '../../../../../src/core/flags/detectors/license.detector.js'
import type { LicensePolicy } from '../../../../../src/core/policy/policy.types.js'

const DEFAULT_POLICY: LicensePolicy = {
  allow: ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Python-2.0', 'MPL-2.0'],
  deny: ['GPL-3.0', 'AGPL-3.0', 'BUSL-1.1'],
  unknown: 'warning',
}

describe('detectLicenseIssues', () => {
  it('returns no flags for allowed licenses', () => {
    expect(detectLicenseIssues('MIT', DEFAULT_POLICY)).toHaveLength(0)
    expect(detectLicenseIssues('Apache-2.0', DEFAULT_POLICY)).toHaveLength(0)
    expect(detectLicenseIssues('Python-2.0', DEFAULT_POLICY)).toHaveLength(0)
  })

  it('flags missing license', () => {
    const flags = detectLicenseIssues(null, DEFAULT_POLICY)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.kind).toBe('license-violation')
    if (flags[0]?.kind === 'license-violation') {
      expect(flags[0].violation).toBe('missing')
    }
  })

  it('flags denied licenses', () => {
    const flags = detectLicenseIssues('GPL-3.0', DEFAULT_POLICY)
    expect(flags).toHaveLength(1)
    if (flags[0]?.kind === 'license-violation') {
      expect(flags[0].violation).toBe('denied')
      expect(flags[0].license).toBe('GPL-3.0')
    }
  })

  it('flags unknown licenses not in allow list', () => {
    const flags = detectLicenseIssues('WTFPL', DEFAULT_POLICY)
    expect(flags).toHaveLength(1)
    if (flags[0]?.kind === 'license-violation') {
      expect(flags[0].violation).toBe('unknown')
    }
  })

  it('flags CC-BY-4.0 as a software license risk when no allow list is configured', () => {
    const policy: LicensePolicy = { allow: [], deny: [], unknown: 'warning' }
    const flags = detectLicenseIssues('CC-BY-4.0', policy)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.kind).toBe('license-risk')
  })

  it('flags non-standard licenses when no allow list', () => {
    const policy: LicensePolicy = { allow: [], deny: [], unknown: 'warning' }
    const flags = detectLicenseIssues('WTFPL', policy)
    expect(flags).toHaveLength(1)
    expect(flags[0]!.kind).toBe('license-risk')
  })

  it('handles SPDX OR expressions', () => {
    const flags = detectLicenseIssues('(MIT OR Apache-2.0)', DEFAULT_POLICY)
    expect(flags).toHaveLength(0) // MIT is in allow list
  })

  it('is case-insensitive', () => {
    expect(detectLicenseIssues('mit', DEFAULT_POLICY)).toHaveLength(0)
  })
})

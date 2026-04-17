import type { LicensePolicy } from '../../policy/policy.types.js'
import type { Flag } from '../flag.types.js'

/** Well-known permissive licenses that are generally safe. */
const COMMON_PERMISSIVE = new Set([
  '0BSD',
  'AFL-3.0',
  'Apache-2.0',
  'Artistic-2.0',
  'BlueOak-1.0.0',
  'BSD-1-Clause',
  'BSD-2-Clause',
  'BSD-2-Clause-Patent',
  'BSD-3-Clause',
  'BSL-1.0',
  'ECL-2.0',
  'MIT',
  'MIT-0',
  'ISC',
  'NCSA',
  'PostgreSQL',
  'Python-2.0',
  'PSF-2.0',
  'Unlicense',
  'Zlib',
  'CC0-1.0',
  'EPL-2.0',
  'EUPL-1.1',
  'EUPL-1.2',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MPL-2.0',
])

/**
 * Detect license violations and risks.
 *
 * Pure function — no I/O.
 */
export function detectLicenseIssues(
  license: string | null | undefined,
  policy: LicensePolicy,
): Flag[] {
  const flags: Flag[] = []

  // Missing license
  if (!license) {
    flags.push({
      kind: 'license-violation',
      license: null,
      violation: 'missing',
    })
    return flags
  }

  const normalized = normalizeLicense(license)

  // Check deny list first
  if (policy.deny.some((denied) => matchesLicense(normalized, denied))) {
    flags.push({
      kind: 'license-violation',
      license: normalized,
      violation: 'denied',
    })
    return flags
  }

  // Check allow list
  if (policy.allow.length > 0) {
    const isAllowed = policy.allow.some((allowed) => matchesLicense(normalized, allowed))

    if (!isAllowed) {
      // Not in allow list — check if it's a known license at all
      if (isCommonPermissive(normalized)) {
        // Known permissive but not in user's allow list — treat as risk
        flags.push({
          kind: 'license-risk',
          license: normalized,
          risk: 'uncommon',
        })
      } else {
        // Unknown license
        flags.push({
          kind: 'license-violation',
          license: normalized,
          violation: 'unknown',
        })
      }
    }
  }

  // Check for non-standard/uncommon licenses (even if no allow list)
  if (flags.length === 0 && !isCommonPermissive(normalized)) {
    flags.push({
      kind: 'license-risk',
      license: normalized,
      risk: 'non-standard',
    })
  }

  return flags
}

/** Normalize a license string for comparison. */
function normalizeLicense(license: string): string {
  // Handle SPDX expressions: "(MIT OR Apache-2.0)" -> check both
  // For now, take the first license in an OR expression
  const stripped = license.replace(/[()]/g, '').trim()
  const orMatch = /^(.+?)\s+OR\s+/i.exec(stripped)
  if (orMatch?.[1]) return orMatch[1].trim()

  return stripped
}

/** Case-insensitive license matching. */
function matchesLicense(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase()
}

/** Case-insensitive check against common permissive licenses. */
function isCommonPermissive(license: string): boolean {
  return [...COMMON_PERMISSIVE].some((known) => known.toLowerCase() === license.toLowerCase())
}

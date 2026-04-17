import type { Severity } from '../../shared/types.js'
import type { FlagKind } from './flag.types.js'

// ── Flag Metadata ───────────────────────────────────────────────────────────
// Single source of truth for flag descriptions, default severities, and
// categories. Uses `as const satisfies` for both type safety and literal
// inference.

export interface FlagMeta {
  readonly category: FlagCategory
  readonly defaultSeverity: Severity
  readonly label: string
  readonly description: string
}

export type FlagCategory =
  | 'security'
  | 'license'
  | 'supply-chain'
  | 'maintenance'
  | 'dependency-tree'
  | 'metadata'

export const FLAG_METADATA = {
  vulnerability: {
    category: 'security',
    defaultSeverity: 'critical',
    label: 'Vulnerability',
    description: 'Package has known CVEs or security advisories',
  },
  deprecated: {
    category: 'maintenance',
    defaultSeverity: 'critical',
    label: 'Deprecated',
    description: 'Package is explicitly deprecated by its maintainer',
  },
  'license-violation': {
    category: 'license',
    defaultSeverity: 'critical',
    label: 'License Violation',
    description: 'Package license violates configured license policy',
  },
  'install-scripts': {
    category: 'supply-chain',
    defaultSeverity: 'warning',
    label: 'Install Scripts',
    description: 'Package runs scripts during installation (preinstall/postinstall)',
  },
  unmaintained: {
    category: 'maintenance',
    defaultSeverity: 'warning',
    label: 'Unmaintained',
    description: 'Package has not been updated recently or repository is archived',
  },
  'single-maintainer': {
    category: 'maintenance',
    defaultSeverity: 'warning',
    label: 'Single Maintainer',
    description: 'Package has only one npm maintainer (bus factor risk)',
  },
  'license-risk': {
    category: 'license',
    defaultSeverity: 'warning',
    label: 'License Risk',
    description: 'Package uses an uncommon or non-standard license',
  },
  'dependency-footprint': {
    category: 'dependency-tree',
    defaultSeverity: 'info',
    label: 'Large Footprint',
    description: 'Package has a large or deeply nested transitive dependency tree',
  },
  'missing-repository': {
    category: 'metadata',
    defaultSeverity: 'info',
    label: 'Missing Repository',
    description: 'Package has no linked source repository or the repository is inaccessible',
  },
  'version-risk': {
    category: 'metadata',
    defaultSeverity: 'info',
    label: 'Version Risk',
    description: 'Package is significantly behind the latest version or uses a prerelease',
  },
} as const satisfies Record<FlagKind, FlagMeta>

/** All flag kinds, derived from the registry. */
export const ALL_FLAG_KINDS = Object.keys(FLAG_METADATA) as readonly FlagKind[]

/** Get the default severity for a flag kind. */
export function getDefaultSeverity(kind: FlagKind): Severity {
  return FLAG_METADATA[kind].defaultSeverity
}

/** Build a default severity map from the registry. */
export function buildDefaultSeverityMap(): Record<FlagKind, Severity> {
  const map = {} as Record<FlagKind, Severity>
  for (const kind of ALL_FLAG_KINDS) {
    map[kind] = FLAG_METADATA[kind].defaultSeverity
  }
  return map
}

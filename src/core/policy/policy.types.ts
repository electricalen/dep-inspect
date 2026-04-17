import type { Severity } from '../../shared/types.js'
import type { FlagKind, PackageFinding } from '../flags/flag.types.js'

/** Rule configuration — either a severity string or an object with threshold. */
export type RuleConfig =
  | Severity
  | 'off'
  | { readonly level: Severity | 'off'; readonly thresholdDays?: number | undefined }

/** License policy configuration. */
export interface LicensePolicy {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
  readonly unknown: Severity
}

/** Waiver for a specific package/flag combination. */
export interface Waiver {
  readonly package: string
  readonly flag: FlagKind
  readonly reason: string
  readonly expires?: string | undefined
}

/** CI configuration. */
export interface CiConfig {
  readonly failOn: Severity
}

/** Cache TTL configuration (raw string durations). */
export interface CacheConfigRaw {
  readonly maxAge?:
    | Partial<{
        readonly registry: string
        readonly github: string
        readonly vulnerability: string
        readonly downloads: string
      }>
    | undefined
  readonly maxSize?: string | undefined
  readonly directory?: string | undefined
}

/** Full policy configuration as loaded from .dep-inspect.json. */
export interface PolicyConfig {
  readonly severity: Partial<Record<FlagKind, RuleConfig>>
  readonly licenses: LicensePolicy
  readonly ci: CiConfig
  readonly cache?: CacheConfigRaw | undefined
  readonly waivers: readonly Waiver[]
}

/** Result of applying policy to a set of findings. */
export interface PolicyResult {
  readonly findings: readonly PackageFinding[]
  readonly status: 'pass' | 'fail'
  readonly criticalCount: number
  readonly warningCount: number
  readonly infoCount: number
}

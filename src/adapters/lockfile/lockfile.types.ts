/** Supported lockfile formats. */
export type LockfileType = 'npm' | 'pnpm' | 'yarn-classic' | 'yarn-berry'

/** A single package entry normalized from any lockfile format. */
export interface LockfilePackage {
  readonly name: string
  readonly version: string
  readonly resolved?: string | undefined
  readonly integrity?: string | undefined
  readonly dependencies?: Readonly<Record<string, string>> | undefined
  readonly optionalDependencies?: Readonly<Record<string, string>> | undefined
  readonly dev: boolean
  readonly optional: boolean
  readonly hasInstallScript: boolean
}

/**
 * Normalized lockfile data — the common shape all parsers produce.
 * Downstream code never knows which lockfile format was used.
 */
export interface LockfileData {
  readonly type: LockfileType
  /** Packages keyed by "name@version" */
  readonly packages: ReadonlyMap<string, LockfilePackage>
}

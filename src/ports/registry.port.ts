import type { ResultAsync } from 'neverthrow'

import type { RegistryError } from '../shared/errors.js'

/** Abbreviated npm package metadata (from registry API). */
export interface PackageMetadata {
  readonly name: string
  readonly description?: string | undefined
  readonly license?: string | undefined
  readonly version: string
  readonly deprecated?: string | undefined
  readonly repository?: RepositoryInfo | undefined
  readonly maintainers: readonly MaintainerInfo[]
  readonly publishedAt: Date
  readonly createdAt: Date
  readonly scripts?: Readonly<Record<string, string>> | undefined
  /** Declared dependency semver ranges for this version (registry packument). */
  readonly dependencies?: Readonly<Record<string, string>> | undefined
  readonly optionalDependencies?: Readonly<Record<string, string>> | undefined
  readonly latestVersion: string
  readonly allVersions: readonly string[]
}

export interface RepositoryInfo {
  readonly type?: string | undefined
  readonly url: string
}

export interface MaintainerInfo {
  readonly name: string
  readonly email?: string | undefined
}

export interface DownloadCount {
  readonly weekly: number
}

/**
 * Port interface for the npm registry.
 */
export interface RegistryPort {
  /** Fetch metadata for a specific package version (or latest). */
  getPackageMetadata(name: string, version?: string): ResultAsync<PackageMetadata, RegistryError>

  /** Fetch weekly download counts. */
  getDownloadCounts(name: string): ResultAsync<DownloadCount, RegistryError>
}

import type { FilePath } from './types.js'

/** Discriminated union of all expected error types in the application. */
export type AppError =
  | RegistryError
  | GitHubError
  | VulnerabilityError
  | LockfileParseError
  | PolicyParseError
  | FilesystemError
  | CacheError
  | ValidationError

export interface RegistryError {
  readonly kind: 'registry'
  readonly message: string
  readonly statusCode?: number
  readonly packageName?: string
}

export interface GitHubError {
  readonly kind: 'github'
  readonly message: string
  readonly statusCode?: number
  readonly owner?: string
  readonly repo?: string
}

export interface VulnerabilityError {
  readonly kind: 'vulnerability'
  readonly message: string
  readonly statusCode?: number
}

export interface LockfileParseError {
  readonly kind: 'lockfile-parse'
  readonly message: string
  readonly filePath: FilePath
}

export interface PolicyParseError {
  readonly kind: 'policy-parse'
  readonly message: string
  readonly filePath?: FilePath
}

export interface FilesystemError {
  readonly kind: 'filesystem'
  readonly message: string
  readonly path: string
}

export interface CacheError {
  readonly kind: 'cache'
  readonly message: string
}

export interface ValidationError {
  readonly kind: 'validation'
  readonly message: string
  readonly input?: string
}

/** Format an AppError for display. */
export function formatError(error: AppError): string {
  switch (error.kind) {
    case 'registry':
      return `Registry error: ${error.message}${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}`
    case 'github':
      return `GitHub error: ${error.message}${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}`
    case 'vulnerability':
      return `Vulnerability DB error: ${error.message}`
    case 'lockfile-parse':
      return `Failed to parse lockfile at ${error.filePath}: ${error.message}`
    case 'policy-parse':
      return `Invalid policy config${error.filePath ? ` at ${error.filePath}` : ''}: ${error.message}`
    case 'filesystem':
      return `Filesystem error at ${error.path}: ${error.message}`
    case 'cache':
      return `Cache error: ${error.message}`
    case 'validation':
      return `Validation error: ${error.message}`
  }
}

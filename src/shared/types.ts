import { err, ok, type Result } from 'neverthrow'

// ── Branded Types ───────────────────────────────────────────────────────────

declare const PackageNameBrand: unique symbol
/** A validated npm package name (scoped or unscoped). */
export type PackageName = string & { readonly [PackageNameBrand]: typeof PackageNameBrand }

declare const SemVerBrand: unique symbol
/** A validated semantic version string. */
export type SemVer = string & { readonly [SemVerBrand]: typeof SemVerBrand }

declare const FilePathBrand: unique symbol
/** A validated filesystem path. */
export type FilePath = string & { readonly [FilePathBrand]: typeof FilePathBrand }

// ── Validation Errors ───────────────────────────────────────────────────────

export interface ValidationError {
  readonly kind: 'validation'
  readonly message: string
  readonly input: string
}

// ── Parse Functions ─────────────────────────────────────────────────────────

const SCOPED_PACKAGE_RE = /^@[a-z\d][\w.-]*\/[a-z\d][\w.-]*$/
const UNSCOPED_PACKAGE_RE = /^[a-z\d][\w.-]*$/

/** Parse and validate an npm package name. */
export function parsePackageName(input: string): Result<PackageName, ValidationError> {
  const trimmed = input.trim().toLowerCase()

  if (trimmed.length === 0) {
    return err({ kind: 'validation', message: 'Package name cannot be empty', input })
  }

  if (trimmed.length > 214) {
    return err({ kind: 'validation', message: 'Package name exceeds 214 characters', input })
  }

  if (!SCOPED_PACKAGE_RE.test(trimmed) && !UNSCOPED_PACKAGE_RE.test(trimmed)) {
    return err({
      kind: 'validation',
      message: `Invalid package name: ${trimmed}`,
      input,
    })
  }

  return ok(trimmed as PackageName)
}

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i

/** Parse and validate a semantic version string. */
export function parseSemVer(input: string): Result<SemVer, ValidationError> {
  const trimmed = input.trim()

  if (!SEMVER_RE.test(trimmed)) {
    return err({
      kind: 'validation',
      message: `Invalid semver: ${trimmed}`,
      input,
    })
  }

  return ok(trimmed as SemVer)
}

/** Create a FilePath from a string (basic validation: non-empty). */
export function parseFilePath(input: string): Result<FilePath, ValidationError> {
  const trimmed = input.trim()

  if (trimmed.length === 0) {
    return err({ kind: 'validation', message: 'File path cannot be empty', input })
  }

  return ok(trimmed as FilePath)
}

// ── Severity ────────────────────────────────────────────────────────────────

export const SEVERITIES = ['info', 'warning', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

// ── Exit Codes ──────────────────────────────────────────────────────────────

export const EXIT_CODES = {
  success: 0,
  criticalFindings: 1,
  toolError: 2,
} as const

import type { GitHubRepoData } from '../../../ports/github.port.js'
import type { PackageMetadata } from '../../../ports/registry.port.js'
import type { Flag } from '../flag.types.js'

/**
 * Detect maintenance-related flags: deprecated, unmaintained, single-maintainer.
 *
 * Pure function — receives pre-fetched data.
 */
export function detectMaintenanceIssues(
  metadata: PackageMetadata,
  thresholdDays: number,
  github?: GitHubRepoData,
): Flag[] {
  const flags: Flag[] = []

  // Deprecated
  if (metadata.deprecated) {
    flags.push({
      kind: 'deprecated',
      reason: metadata.deprecated,
    })
  }

  // Unmaintained: check last publish date
  const daysSincePublish = daysBetween(metadata.publishedAt, new Date())

  const isArchived = github?.isArchived === true
  if (daysSincePublish > thresholdDays || isArchived) {
    const lastPublishDate =
      metadata.publishedAt instanceof Date
        ? metadata.publishedAt
        : new Date(String(metadata.publishedAt))
    flags.push({
      kind: 'unmaintained',
      lastPublishDate,
      daysSincePublish,
      thresholdDays,
      isArchived: isArchived || undefined,
      commitsLast12Months: github?.commitsLast12Months,
    })
  }

  // Single maintainer
  const npmMaintainerCount = metadata.maintainers.length
  if (npmMaintainerCount <= 1) {
    flags.push({
      kind: 'single-maintainer',
      npmMaintainerCount,
      githubContributorCount: github?.contributorCount,
    })
  }

  return flags
}

function toTimeMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime()
  return new Date(value).getTime()
}

function daysBetween(a: Date | string, b: Date | string): number {
  const ms = Math.abs(toTimeMs(b) - toTimeMs(a))
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

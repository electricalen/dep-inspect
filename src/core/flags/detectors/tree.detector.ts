import type { GraphMetrics } from '../../graph/graph.types.js'
import type { Flag } from '../flag.types.js'

/** Thresholds for dependency tree risk signals. */
const THRESHOLDS = {
  transitiveCount: 100,
  maxDepth: 8,
  duplicatedPackages: 10,
} as const

/**
 * Detect dependency tree size/complexity flags.
 *
 * Pure function — receives pre-computed metrics.
 */
export function detectTreeIssues(metrics: GraphMetrics): Flag[] {
  const flags: Flag[] = []

  const isLarge =
    metrics.transitiveCount > THRESHOLDS.transitiveCount ||
    metrics.maxDepth > THRESHOLDS.maxDepth ||
    metrics.duplicatedPackages > THRESHOLDS.duplicatedPackages

  if (isLarge) {
    flags.push({
      kind: 'dependency-footprint',
      transitiveCount: metrics.transitiveCount,
      uniqueCount: metrics.uniquePackageNames,
      duplicatedCount: metrics.duplicatedPackages,
      maxDepth: metrics.maxDepth,
    })
  }

  return flags
}

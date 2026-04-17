/** A node in the dependency graph. */
export interface DepNode {
  readonly name: string
  readonly version: string
  readonly isDirect: boolean
  readonly isRuntime: boolean
  readonly depth: number
  readonly hasInstallScript: boolean
}

/** Metrics computed from the dependency graph. */
export interface GraphMetrics {
  readonly totalPackages: number
  readonly directCount: number
  readonly transitiveCount: number
  readonly maxDepth: number
  readonly uniquePackageNames: number
  readonly duplicatedPackages: number
}

/**
 * An immutable dependency graph built from lockfile data.
 */
export interface DepGraph {
  /** Get a node by "name@version" key. */
  getNode(key: string): DepNode | undefined

  /** Get all nodes. */
  allNodes(): ReadonlyMap<string, DepNode>

  /** Get direct dependencies only. */
  directDeps(): ReadonlyMap<string, DepNode>

  /** Get the children (direct dependencies) of a node. */
  childrenOf(key: string): readonly string[]

  /** Get all unique package names (without version). */
  uniquePackageNames(): readonly string[]

  /** Compute graph metrics. */
  metrics(): GraphMetrics
}

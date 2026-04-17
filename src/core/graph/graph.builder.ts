import semver from 'semver'

import type { LockfileData, LockfilePackage } from '../../adapters/lockfile/lockfile.types.js'
import type { DepGraph, DepNode, GraphMetrics } from './graph.types.js'

interface PackageJson {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/**
 * Build a dependency graph from lockfile data and package.json.
 *
 * This is a pure function — no I/O.
 */
export function buildDepGraph(lockfile: LockfileData, packageJson: PackageJson): DepGraph {
  const directNames = new Set<string>()
  const devNames = new Set<string>()

  // Collect direct dependency names
  if (packageJson.dependencies) {
    for (const name of Object.keys(packageJson.dependencies)) {
      directNames.add(name)
    }
  }
  if (packageJson.devDependencies) {
    for (const name of Object.keys(packageJson.devDependencies)) {
      directNames.add(name)
      devNames.add(name)
    }
  }

  // Build nodes and adjacency list
  const nodes = new Map<string, DepNode>()
  const edges = new Map<string, string[]>()

  for (const [key, pkg] of lockfile.packages) {
    const isDirect = directNames.has(pkg.name)
    const isRuntime = isDirect ? !devNames.has(pkg.name) : !pkg.dev

    nodes.set(key, {
      name: pkg.name,
      version: pkg.version,
      isDirect,
      isRuntime,
      depth: isDirect ? 1 : -1, // Will be computed via BFS
      hasInstallScript: pkg.hasInstallScript,
    })

    // Build edges from dependencies
    const children: string[] = []
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    }

    for (const depName of Object.keys(allDeps)) {
      const spec = allDeps[depName] ?? ''
      const childKey = resolveChildPackageKey(lockfile.packages, depName, spec)
      if (childKey) children.push(childKey)
    }

    edges.set(key, children)
  }

  // Compute depths via BFS from direct dependencies
  const visited = new Set<string>()
  const queue: { key: string; depth: number }[] = []

  for (const [key, node] of nodes) {
    if (node.isDirect) {
      queue.push({ key, depth: 1 })
      visited.add(key)
    }
  }

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break

    const node = nodes.get(item.key)
    if (node) {
      // Update depth (create new object since DepNode is readonly)
      nodes.set(item.key, { ...node, depth: item.depth })
    }

    const children = edges.get(item.key) ?? []
    for (const childKey of children) {
      if (!visited.has(childKey)) {
        visited.add(childKey)
        queue.push({ key: childKey, depth: item.depth + 1 })
      }
    }
  }

  // Set depth 0 for unreachable nodes (shouldn't happen in valid lockfiles)
  for (const [key, node] of nodes) {
    if (node.depth === -1) {
      nodes.set(key, { ...node, depth: 0 })
    }
  }

  return createGraph(nodes, edges)
}

/**
 * Map a dependency entry to a lockfile package key.
 * Prefers `name@spec` when present (exact resolution); falls back to first name match.
 */
function resolveChildPackageKey(
  packages: ReadonlyMap<string, LockfilePackage>,
  depName: string,
  spec: string,
): string | undefined {
  const directKey = `${depName}@${spec}`
  if (packages.has(directKey)) return directKey

  const cleaned = semver.clean(spec)
  if (cleaned) {
    const cleanedKey = `${depName}@${cleaned}`
    if (packages.has(cleanedKey)) return cleanedKey
  }

  if (semver.valid(spec)) {
    for (const [candidateKey, candidatePkg] of packages) {
      if (candidatePkg.name === depName && candidatePkg.version === spec) {
        return candidateKey
      }
    }
  }

  for (const [candidateKey, candidatePkg] of packages) {
    if (candidatePkg.name === depName) return candidateKey
  }

  return undefined
}

function createGraph(nodes: Map<string, DepNode>, edges: Map<string, string[]>): DepGraph {
  const frozenNodes: ReadonlyMap<string, DepNode> = nodes
  const directDepsMap = new Map<string, DepNode>()
  for (const [key, node] of nodes) {
    if (node.isDirect) directDepsMap.set(key, node)
  }

  return {
    getNode(key: string): DepNode | undefined {
      return frozenNodes.get(key)
    },

    allNodes(): ReadonlyMap<string, DepNode> {
      return frozenNodes
    },

    directDeps(): ReadonlyMap<string, DepNode> {
      return directDepsMap
    },

    childrenOf(key: string): readonly string[] {
      return edges.get(key) ?? []
    },

    uniquePackageNames(): readonly string[] {
      const names = new Set<string>()
      for (const node of frozenNodes.values()) {
        names.add(node.name)
      }
      return [...names]
    },

    metrics(): GraphMetrics {
      const names = new Set<string>()
      const nameCounts = new Map<string, number>()
      let maxDepth = 0

      for (const node of frozenNodes.values()) {
        names.add(node.name)
        nameCounts.set(node.name, (nameCounts.get(node.name) ?? 0) + 1)
        if (node.depth > maxDepth) maxDepth = node.depth
      }

      let duplicated = 0
      for (const count of nameCounts.values()) {
        if (count > 1) duplicated++
      }

      return {
        totalPackages: frozenNodes.size,
        directCount: directDepsMap.size,
        transitiveCount: frozenNodes.size - directDepsMap.size,
        maxDepth,
        uniquePackageNames: names.size,
        duplicatedPackages: duplicated,
      }
    },
  }
}

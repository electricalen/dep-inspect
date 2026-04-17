import { describe, expect, it } from 'vitest'

import { formatScan } from '../../../../src/cli/formatters/human.formatter.js'
import { DEFAULT_POLICY } from '../../../../src/config/config.defaults.js'
import type {
  ProjectAnalysis,
  ScanStatistics,
} from '../../../../src/core/analysis/project.analyzer.js'
import type { PackageFinding } from '../../../../src/core/flags/flag.types.js'
import type { DepGraph, DepNode, GraphMetrics } from '../../../../src/core/graph/graph.types.js'
import { parsePackageName } from '../../../../src/shared/types.js'

function makeNode(node: DepNode): DepNode {
  return node
}

function makeGraph(nodes: DepNode[]): DepGraph {
  const entries = new Map(nodes.map((node) => [`${node.name}@${node.version}`, node]))
  const directs = new Map(
    nodes.filter((node) => node.isDirect).map((node) => [`${node.name}@${node.version}`, node]),
  )

  return {
    getNode: (key) => entries.get(key),
    allNodes: () => entries,
    directDeps: () => directs,
    childrenOf: () => [],
    uniquePackageNames: () => [...new Set(nodes.map((node) => node.name))],
    metrics: () => ({
      totalPackages: nodes.length,
      directCount: nodes.filter((node) => node.isDirect).length,
      transitiveCount: nodes.filter((node) => !node.isDirect).length,
      maxDepth: Math.max(...nodes.map((node) => node.depth), 0),
      uniquePackageNames: new Set(nodes.map((node) => node.name)).size,
      duplicatedPackages: 0,
    }),
  }
}

function makeFinding(finding: PackageFinding): PackageFinding {
  return finding
}

function pkg(name: string) {
  const parsed = parsePackageName(name)
  if (parsed.isErr()) {
    throw new Error(parsed.error.message)
  }
  return parsed.value
}

function makeScanStats(overrides: Partial<ScanStatistics> = {}): ScanStatistics {
  return {
    totalPackages: 5,
    scannedSuccessfully: 5,
    skippedPackages: 0,
    cleanPackages: 1,
    flaggedPackages: 4,
    flagCounts: {
      deprecated: 2,
      unmaintained: 1,
      'install-scripts': 1,
    },
    totalVulnerabilities: 0,
    skippedNames: [],
    vulnQueryFailures: [],
    ...overrides,
  }
}

function makeAnalysis(
  findings: PackageFinding[],
  stats: ScanStatistics = makeScanStats(),
  metrics?: GraphMetrics,
): ProjectAnalysis {
  const graph = makeGraph([
    makeNode({
      name: 'request',
      version: '2.88.2',
      isDirect: true,
      isRuntime: true,
      depth: 1,
      hasInstallScript: false,
    }),
    makeNode({
      name: 'some-sdk',
      version: '1.3.0',
      isDirect: true,
      isRuntime: true,
      depth: 1,
      hasInstallScript: false,
    }),
    makeNode({
      name: 'firebase-admin',
      version: '11.0.0',
      isDirect: true,
      isRuntime: true,
      depth: 1,
      hasInstallScript: false,
    }),
    makeNode({
      name: 'left-pad',
      version: '1.3.0',
      isDirect: false,
      isRuntime: true,
      depth: 2,
      hasInstallScript: false,
    }),
    makeNode({
      name: 'build-tool',
      version: '2.0.0',
      isDirect: false,
      isRuntime: true,
      depth: 2,
      hasInstallScript: true,
    }),
  ])

  return {
    graph,
    metrics: metrics ?? graph.metrics(),
    policyResult: {
      findings,
      status: 'fail',
      criticalCount: 2,
      warningCount: 2,
      infoCount: 0,
    },
    treeFlags: [],
    githubEnabled: false,
    scanStats: stats,
  }
}

describe('formatScan', () => {
  it('shows a concise actionable summary by default', () => {
    const output = formatScan(
      makeAnalysis([
        makeFinding({
          name: pkg('request'),
          version: '2.88.2',
          isDirect: true,
          isRuntime: true,
          waived: [],
          flags: [{ kind: 'deprecated', reason: 'request has been deprecated' }],
        }),
        makeFinding({
          name: pkg('build-tool'),
          version: '2.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('firebase-admin'),
          waived: [],
          flags: [{ kind: 'install-scripts', scripts: ['postinstall'] }],
        }),
      ]),
      DEFAULT_POLICY,
    )

    expect(output).toContain('Dependency scan')
    expect(output).toContain('Verdict:')
    expect(output).toContain('Most Common Issues')
    expect(output).toContain('Review These First')
    expect(output).toContain('request@2.88.2')
    expect(output).toContain('(Direct dependency)')
    expect(output).toContain('deprecated by maintainer')
    expect(output).toContain('build-tool@2.0.0')
    expect(output).toContain('(Transitive via firebase-admin)')
    expect(output).toContain('postinstall install hook')
    expect(output).toContain('Suggested Next Step')
    expect(output).toContain('Use --details for the full package-by-package breakdown')
    expect(output).not.toContain('Dependency Summary')
    expect(output).not.toContain('Top Indirect Package Risks')
  })

  it('shows direct dependencies first and rolls transitive risk into summaries in detailed mode', () => {
    const output = formatScan(
      makeAnalysis([
        makeFinding({
          name: pkg('request'),
          version: '2.88.2',
          isDirect: true,
          isRuntime: true,
          waived: [],
          flags: [{ kind: 'deprecated', reason: 'request has been deprecated' }],
        }),
        makeFinding({
          name: pkg('some-sdk'),
          version: '1.3.0',
          isDirect: true,
          isRuntime: true,
          waived: [],
          flags: [
            {
              kind: 'unmaintained',
              lastPublishDate: new Date('2021-01-01'),
              daysSincePublish: 1200,
              thresholdDays: 730,
            },
            { kind: 'single-maintainer', npmMaintainerCount: 1 },
          ],
        }),
        makeFinding({
          name: pkg('left-pad'),
          version: '1.3.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('some-sdk'),
          waived: [],
          flags: [{ kind: 'deprecated', reason: 'deprecated transitive' }],
        }),
        makeFinding({
          name: pkg('build-tool'),
          version: '2.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('firebase-admin'),
          waived: [],
          flags: [{ kind: 'install-scripts', scripts: ['postinstall'] }],
        }),
      ]),
      DEFAULT_POLICY,
      { details: true },
    )

    expect(output).toContain('Dependency Summary')
    expect(output).toContain('Direct dependencies: 3 packages you added')
    expect(output).toContain('Indirect packages: 2 pulled in by those dependencies')
    expect(output).toContain('indirect packages with issues: 2')
    expect(output).toContain('Dependencies You Added')
    expect(output).toContain('request@2.88.2')
    expect(output).toContain('- deprecated')
    expect(output).toContain('- used in production')
    expect(output).toContain('some-sdk@1.3.0')
    expect(output).toContain('- no recent release')
    expect(output).toContain('- low maintainer coverage')
    expect(output).toContain('- 1 indirect package with issues')
    expect(output).toContain('includes deprecated package: left-pad')
    expect(output).toContain('firebase-admin@11.0.0')
    expect(output).toContain('includes runs install-time scripts package: build-tool')
    expect(output).toContain('Issues From Indirect Packages')
    expect(output).toContain('2 direct dependencies introduce indirect packages with issues')
    expect(output).toContain('Top Indirect Package Risks')
    expect(output).not.toContain('══ CRITICAL')
  })

  it('includes the suggested direct critical dependency in the review shortlist', () => {
    const output = formatScan(
      makeAnalysis([
        makeFinding({
          name: pkg('next'),
          version: '16.1.6',
          isDirect: true,
          isRuntime: true,
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                {
                  id: 'NEXT-1',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
              ],
            },
          ],
        }),
        makeFinding({
          name: pkg('ajv'),
          version: '6.12.6',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('eslint'),
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                { id: 'AJV-1', severity: 'critical', summary: 'critical vuln', fixAvailable: true },
              ],
            },
            {
              kind: 'unmaintained',
              lastPublishDate: new Date('2020-01-01'),
              daysSincePublish: 2000,
              thresholdDays: 730,
            },
          ],
        }),
        makeFinding({
          name: pkg('minimatch-a'),
          version: '1.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('eslint'),
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                {
                  id: 'MINI-1',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-2',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-3',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
              ],
            },
            { kind: 'install-scripts', scripts: ['prepare'] },
          ],
        }),
        makeFinding({
          name: pkg('minimatch-b'),
          version: '1.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('eslint'),
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                {
                  id: 'MINI-4',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-5',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-6',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
              ],
            },
            { kind: 'install-scripts', scripts: ['prepare'] },
          ],
        }),
        makeFinding({
          name: pkg('minimatch-c'),
          version: '1.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('eslint'),
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                {
                  id: 'MINI-7',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-8',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-9',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
              ],
            },
            { kind: 'install-scripts', scripts: ['prepare'] },
          ],
        }),
        makeFinding({
          name: pkg('minimatch-d'),
          version: '1.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('eslint'),
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                {
                  id: 'MINI-10',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-11',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-12',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
              ],
            },
            { kind: 'install-scripts', scripts: ['prepare'] },
          ],
        }),
        makeFinding({
          name: pkg('minimatch-e'),
          version: '1.0.0',
          isDirect: false,
          isRuntime: true,
          introducedBy: pkg('eslint'),
          waived: [],
          flags: [
            {
              kind: 'vulnerability',
              vulnerabilities: [
                {
                  id: 'MINI-13',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-14',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
                {
                  id: 'MINI-15',
                  severity: 'critical',
                  summary: 'critical vuln',
                  fixAvailable: true,
                },
              ],
            },
            { kind: 'install-scripts', scripts: ['prepare'] },
          ],
        }),
      ]),
      DEFAULT_POLICY,
    )

    expect(output).toContain(
      'Start with next@16.1.6; it is a direct dependency with blocking findings.',
    )
    expect(output).toContain('next@16.1.6')
    expect(output).toContain('(Direct dependency)')
  })

  it('shows a clean direct-dependency review section when no findings exist', () => {
    const output = formatScan(
      makeAnalysis(
        [],
        makeScanStats({
          cleanPackages: 5,
          flaggedPackages: 0,
          flagCounts: {},
        }),
        {
          totalPackages: 5,
          directCount: 3,
          transitiveCount: 2,
          maxDepth: 2,
          uniquePackageNames: 5,
          duplicatedPackages: 0,
        },
      ),
      DEFAULT_POLICY,
      { details: true },
    )

    expect(output).toContain('No direct dependencies require review')
    expect(output).not.toContain('Top Indirect Package Risks')
    expect(output).not.toContain('Issues From Indirect Packages')
  })
})

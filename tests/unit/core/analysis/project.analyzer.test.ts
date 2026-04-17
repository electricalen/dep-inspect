import { ok, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { analyzeProject } from '../../../../src/core/analysis/project.analyzer.js'
import type {
  LockfileData,
  LockfilePackage,
} from '../../../../src/adapters/lockfile/lockfile.types.js'
import type { GitHubPort } from '../../../../src/ports/github.port.js'
import type { LockfilePort } from '../../../../src/ports/lockfile.port.js'
import type { PackageMetadata, RegistryPort } from '../../../../src/ports/registry.port.js'
import type { VulnerabilityPort } from '../../../../src/ports/vulnerability.port.js'
import { DEFAULT_POLICY } from '../../../../src/config/config.defaults.js'

// ── Test Helpers ───────────────────────────────────────────────────────────

function packageNameFromLockfileKey(key: string): string {
  if (key.startsWith('@')) {
    const idx = key.lastIndexOf('@')
    return key.slice(0, idx)
  }
  const idx = key.lastIndexOf('@')
  return idx === -1 ? key : key.slice(0, idx)
}

function makeLockfileData(packages: [string, Partial<LockfilePackage>][]): LockfileData {
  const pkgMap = new Map<string, LockfilePackage>()
  for (const [key, partial] of packages) {
    const base: LockfilePackage = {
      name: packageNameFromLockfileKey(key),
      version: '1.0.0',
      dev: false,
      optional: false,
      hasInstallScript: false,
    }
    pkgMap.set(key, { ...base, ...partial, name: partial.name ?? base.name })
  }
  return {
    type: 'npm',
    packages: pkgMap,
  }
}

function fakeRegistry(metadataMap: Map<string, PackageMetadata>): RegistryPort {
  return {
    getPackageMetadata: (name: string) => {
      const metadata = metadataMap.get(name)
      if (metadata) return okAsync(metadata)
      return okAsync({
        name,
        version: '1.0.0',
        license: 'MIT',
        maintainers: [{ name: 'alice' }, { name: 'bob' }],
        publishedAt: new Date(),
        createdAt: new Date(),
        latestVersion: '1.0.0',
        allVersions: ['1.0.0'],
        repository: { url: `https://github.com/test/${name}` },
      })
    },
    getDownloadCounts: () => okAsync({ weekly: 5000 }),
  }
}

function fakeVulnerability(): VulnerabilityPort {
  return {
    query: () => okAsync([]),
  }
}

function fakeLockfile(lockfileData: LockfileData): LockfilePort {
  return {
    parse: () => ok(lockfileData),
  }
}

function fakeGitHub(): GitHubPort {
  return {
    fetchRepo: (owner, repo) =>
      okAsync({
        owner,
        repo,
        stars: 100,
        forks: 10,
        contributorCount: 5,
        lastCommitDate: new Date(),
        openIssues: 3,
        closedIssues: 30,
        isArchived: false,
        commitsLast12Months: 20,
      }),
  }
}

const PACKAGE_JSON = {
  name: 'my-app',
  version: '1.0.0',
  dependencies: {
    lodash: '^4.17.21',
    express: '^4.18.0',
  },
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('analyzeProject', () => {
  it('analyzes a simple project with direct deps', async () => {
    const lockfileData = makeLockfileData([
      ['lodash@4.17.21', { name: 'lodash', version: '4.17.21' }],
      ['express@4.18.2', { name: 'express', version: '4.18.2' }],
    ])

    const result = analyzeProject('.', PACKAGE_JSON, {
      registry: fakeRegistry(new Map()),
      vulnerability: fakeVulnerability(),
      lockfile: fakeLockfile(lockfileData),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    expect(analysis.value.metrics.totalPackages).toBe(2)
    expect(analysis.value.policyResult).toBeDefined()
  })

  it('includes tree-level flags for large dependency trees', async () => {
    // Create a lockfile with many packages to trigger tree detector
    const packages: [string, Partial<LockfilePackage>][] = []
    for (let i = 0; i < 120; i++) {
      packages.push([`pkg-${i}@1.0.0`, { name: `pkg-${i}`, version: '1.0.0' }])
    }

    const lockfileData = makeLockfileData(packages)

    const result = analyzeProject(
      '.',
      { name: 'big-app', dependencies: { 'pkg-0': '1.0.0' } },
      {
        registry: fakeRegistry(new Map()),
        vulnerability: fakeVulnerability(),
        lockfile: fakeLockfile(lockfileData),
        policy: DEFAULT_POLICY,
      },
    )

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    // 120 packages should trigger the dependency-footprint flag
    expect(analysis.value.treeFlags.length).toBeGreaterThan(0)
    expect(analysis.value.treeFlags[0]?.kind).toBe('dependency-footprint')
  })

  it('reports policy pass for clean projects', async () => {
    const lockfileData = makeLockfileData([
      ['lodash@4.17.21', { name: 'lodash', version: '4.17.21' }],
    ])

    const result = analyzeProject('.', PACKAGE_JSON, {
      registry: fakeRegistry(new Map()),
      vulnerability: fakeVulnerability(),
      lockfile: fakeLockfile(lockfileData),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    expect(analysis.value.policyResult.status).toBe('pass')
  })

  it('populates scanStats with verification data', async () => {
    const lockfileData = makeLockfileData([
      ['lodash@4.17.21', { name: 'lodash', version: '4.17.21' }],
      ['express@4.18.2', { name: 'express', version: '4.18.2' }],
    ])

    const result = analyzeProject('.', PACKAGE_JSON, {
      registry: fakeRegistry(new Map()),
      vulnerability: fakeVulnerability(),
      lockfile: fakeLockfile(lockfileData),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    const { scanStats } = analysis.value
    expect(scanStats.totalPackages).toBe(2)
    expect(scanStats.scannedSuccessfully).toBe(2)
    expect(scanStats.skippedPackages).toBe(0)
    expect(scanStats.skippedNames).toEqual([])
    // With fake registry providing MIT + 2 maintainers, packages should be clean
    expect(scanStats.cleanPackages + scanStats.flaggedPackages).toBe(2)
    expect(scanStats.totalVulnerabilities).toBe(0)
  })

  it('tracks flagged packages in scanStats', async () => {
    const lockfileData = makeLockfileData([
      ['old-pkg@1.0.0', { name: 'old-pkg', version: '1.0.0' }],
    ])

    const deprecatedMetadata: PackageMetadata = {
      name: 'old-pkg',
      version: '1.0.0',
      license: 'MIT',
      deprecated: 'Use new-pkg instead',
      maintainers: [{ name: 'alice' }, { name: 'bob' }],
      publishedAt: new Date(),
      createdAt: new Date(),
      latestVersion: '1.0.0',
      allVersions: ['1.0.0'],
      repository: { url: 'https://github.com/test/old-pkg' },
    }

    const metadataMap = new Map<string, PackageMetadata>()
    metadataMap.set('old-pkg', deprecatedMetadata)

    const result = analyzeProject(
      '.',
      { ...PACKAGE_JSON, dependencies: { 'old-pkg': '1.0.0' } },
      {
        registry: fakeRegistry(metadataMap),
        vulnerability: fakeVulnerability(),
        lockfile: fakeLockfile(lockfileData),
        policy: DEFAULT_POLICY,
      },
    )

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    const { scanStats } = analysis.value
    expect(scanStats.flaggedPackages).toBeGreaterThan(0)
    expect(scanStats.flagCounts.deprecated).toBe(1)
  })

  it('detects deprecated packages in the tree', async () => {
    const lockfileData = makeLockfileData([
      ['old-pkg@1.0.0', { name: 'old-pkg', version: '1.0.0' }],
    ])

    const deprecatedMetadata: PackageMetadata = {
      name: 'old-pkg',
      version: '1.0.0',
      license: 'MIT',
      deprecated: 'Use new-pkg instead',
      maintainers: [{ name: 'alice' }, { name: 'bob' }],
      publishedAt: new Date(),
      createdAt: new Date(),
      latestVersion: '1.0.0',
      allVersions: ['1.0.0'],
      repository: { url: 'https://github.com/test/old-pkg' },
    }

    const metadataMap = new Map<string, PackageMetadata>()
    metadataMap.set('old-pkg', deprecatedMetadata)

    const result = analyzeProject(
      '.',
      { ...PACKAGE_JSON, dependencies: { 'old-pkg': '1.0.0' } },
      {
        registry: fakeRegistry(metadataMap),
        vulnerability: fakeVulnerability(),
        lockfile: fakeLockfile(lockfileData),
        policy: DEFAULT_POLICY,
      },
    )

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    const deprecated = analysis.value.policyResult.findings.find((f) =>
      f.flags.some((flag) => flag.kind === 'deprecated'),
    )
    expect(deprecated).toBeDefined()
    expect(analysis.value.policyResult.status).toBe('fail') // deprecated is critical
  })

  it('records which direct dependency introduces a transitive finding', async () => {
    const lockfileData = makeLockfileData([
      [
        'next@16.1.6',
        {
          name: 'next',
          version: '16.1.6',
          dependencies: { ajv: '6.12.6' },
        },
      ],
      ['ajv@6.12.6', { name: 'ajv', version: '6.12.6' }],
    ])

    const staleMetadata: PackageMetadata = {
      name: 'ajv',
      version: '6.12.6',
      license: 'MIT',
      maintainers: [{ name: 'alice' }, { name: 'bob' }],
      publishedAt: new Date('2020-01-01T00:00:00.000Z'),
      createdAt: new Date('2016-01-01T00:00:00.000Z'),
      latestVersion: '8.17.1',
      allVersions: ['6.12.6', '8.17.1'],
      repository: { url: 'https://github.com/test/ajv' },
    }

    const result = analyzeProject(
      '.',
      { name: 'web-app', dependencies: { next: '16.1.6' } },
      {
        registry: fakeRegistry(new Map([['ajv', staleMetadata]])),
        vulnerability: fakeVulnerability(),
        lockfile: fakeLockfile(lockfileData),
        policy: DEFAULT_POLICY,
      },
    )

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const analysis = await result.value
    expect(analysis.isOk()).toBe(true)
    if (!analysis.isOk()) return

    const transitiveFinding = analysis.value.policyResult.findings.find(
      (finding) => finding.name === 'ajv' && finding.version === '6.12.6',
    )

    expect(transitiveFinding).toBeDefined()
    expect(transitiveFinding?.isDirect).toBe(false)
    expect(transitiveFinding?.introducedBy).toBe('next')
  })

  it('tracks githubEnabled flag', async () => {
    const lockfileData = makeLockfileData([
      ['lodash@4.17.21', { name: 'lodash', version: '4.17.21' }],
    ])

    const withGitHub = analyzeProject('.', PACKAGE_JSON, {
      registry: fakeRegistry(new Map()),
      vulnerability: fakeVulnerability(),
      lockfile: fakeLockfile(lockfileData),
      github: fakeGitHub(),
      policy: DEFAULT_POLICY,
    })

    const withoutGitHub = analyzeProject('.', PACKAGE_JSON, {
      registry: fakeRegistry(new Map()),
      vulnerability: fakeVulnerability(),
      lockfile: fakeLockfile(lockfileData),
      policy: DEFAULT_POLICY,
    })

    expect(withGitHub.isOk() && withoutGitHub.isOk()).toBe(true)
    if (!withGitHub.isOk() || !withoutGitHub.isOk()) return

    const r1 = await withGitHub.value
    const r2 = await withoutGitHub.value
    expect(r1.isOk() && r2.isOk()).toBe(true)
    if (!r1.isOk() || !r2.isOk()) return

    expect(r1.value.githubEnabled).toBe(true)
    expect(r2.value.githubEnabled).toBe(false)
  })
})

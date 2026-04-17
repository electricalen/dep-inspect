import { okAsync, errAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { analyzePackage } from '../../../../src/core/analysis/package.analyzer.js'
import type { GitHubPort, GitHubRepoData } from '../../../../src/ports/github.port.js'
import type { PackageMetadata, RegistryPort } from '../../../../src/ports/registry.port.js'
import type {
  VulnerabilityAdvisory,
  VulnerabilityPort,
} from '../../../../src/ports/vulnerability.port.js'
import type { PolicyConfig } from '../../../../src/core/policy/policy.types.js'
import { DEFAULT_POLICY } from '../../../../src/config/config.defaults.js'

// ── Test Helpers ───────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<PackageMetadata> = {}): PackageMetadata {
  return {
    name: 'test-pkg',
    version: '1.0.0',
    license: 'MIT',
    maintainers: [{ name: 'alice' }, { name: 'bob' }],
    publishedAt: new Date(),
    createdAt: new Date(),
    latestVersion: '1.0.0',
    allVersions: ['1.0.0'],
    repository: { url: 'https://github.com/test/test-pkg' },
    ...overrides,
  }
}

function makeGitHub(overrides: Partial<GitHubRepoData> = {}): GitHubRepoData {
  return {
    owner: 'test',
    repo: 'test-pkg',
    stars: 500,
    forks: 20,
    contributorCount: 10,
    lastCommitDate: new Date(),
    openIssues: 5,
    closedIssues: 50,
    isArchived: false,
    commitsLast12Months: 30,
    ...overrides,
  }
}

function fakeRegistry(metadata: PackageMetadata): RegistryPort {
  return {
    getPackageMetadata: () => okAsync(metadata),
    getDownloadCounts: () => okAsync({ weekly: 10000 }),
  }
}

function fakeVulnerability(advisories: readonly VulnerabilityAdvisory[] = []): VulnerabilityPort {
  return {
    query: () => okAsync(advisories),
  }
}

function fakeGitHub(data: GitHubRepoData): GitHubPort {
  return {
    fetchRepo: () => okAsync(data),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('analyzePackage', () => {
  it('returns analysis with no flags for a healthy package', async () => {
    const metadata = makeMetadata()
    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    expect(result.value.metadata.name).toBe('test-pkg')
    expect(result.value.downloads).toEqual({ weekly: 10000 })
    expect(result.value.rawFlags).toHaveLength(0)
    expect(result.value.finding).toBeNull()
  })

  it('detects vulnerabilities', async () => {
    const metadata = makeMetadata()
    const advisories: VulnerabilityAdvisory[] = [
      {
        id: 'CVE-2024-1234',
        summary: 'Critical RCE',
        severity: 'critical',
        fixAvailable: true,
        affectedVersions: '<2.0.0',
      },
    ]

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(advisories),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const vulnFlag = result.value.rawFlags.find((f) => f.kind === 'vulnerability')
    expect(vulnFlag).toBeDefined()
    expect(result.value.finding).not.toBeNull()
  })

  it('includes GitHub data when github port is provided', async () => {
    const metadata = makeMetadata()
    const github = makeGitHub()

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      github: fakeGitHub(github),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    expect(result.value.github).toBeDefined()
    expect(result.value.github?.stars).toBe(500)
  })

  it('omits GitHub data when github port is not provided', async () => {
    const metadata = makeMetadata()

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    expect(result.value.github).toBeUndefined()
  })

  it('gracefully handles GitHub API failures', async () => {
    const metadata = makeMetadata()
    const failingGitHub: GitHubPort = {
      fetchRepo: () =>
        errAsync({
          kind: 'github' as const,
          message: 'rate limited',
          statusCode: 403,
        }),
    }

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      github: failingGitHub,
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    expect(result.value.github).toBeUndefined()
  })

  it('propagates registry errors', async () => {
    const failingRegistry: RegistryPort = {
      getPackageMetadata: () =>
        errAsync({
          kind: 'registry' as const,
          message: 'Package not found',
          statusCode: 404,
        }),
      getDownloadCounts: () => okAsync({ weekly: 0 }),
    }

    const result = await analyzePackage('nonexistent', undefined, {
      registry: failingRegistry,
      vulnerability: fakeVulnerability(),
      policy: DEFAULT_POLICY,
    })

    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return

    expect(result.error.kind).toBe('registry')
  })

  it('detects deprecated packages', async () => {
    const metadata = makeMetadata({ deprecated: 'Use new-pkg instead' })

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const deprecated = result.value.rawFlags.find((f) => f.kind === 'deprecated')
    expect(deprecated).toBeDefined()
  })

  it('detects license violations', async () => {
    const metadata = makeMetadata({ license: 'GPL-3.0' })

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      policy: DEFAULT_POLICY,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    const licenseFlag = result.value.rawFlags.find((f) => f.kind === 'license-violation')
    expect(licenseFlag).toBeDefined()
  })

  it('applies waivers from policy', async () => {
    const metadata = makeMetadata({
      scripts: { postinstall: 'node setup.js' },
    })

    const policy: PolicyConfig = {
      ...DEFAULT_POLICY,
      waivers: [
        {
          package: 'test-pkg',
          flag: 'install-scripts',
          reason: 'Approved native dependency',
        },
      ],
    }

    const result = await analyzePackage('test-pkg', undefined, {
      registry: fakeRegistry(metadata),
      vulnerability: fakeVulnerability(),
      policy,
    })

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    // install-scripts flag should be waived, not active
    if (result.value.finding) {
      const activeInstallScripts = result.value.finding.flags.find(
        (f) => f.kind === 'install-scripts',
      )
      expect(activeInstallScripts).toBeUndefined()
      expect(result.value.finding.waived).toContainEqual(
        expect.objectContaining({ flag: 'install-scripts' }),
      )
    }
  })
})

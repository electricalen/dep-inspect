import { describe, expect, it } from 'vitest'

import { detectMaintenanceIssues } from '../../../../../src/core/flags/detectors/maintenance.detector.js'
import type { PackageMetadata } from '../../../../../src/ports/registry.port.js'
import type { GitHubRepoData } from '../../../../../src/ports/github.port.js'

function makeMetadata(overrides: Partial<PackageMetadata> = {}): PackageMetadata {
  return {
    name: 'test-pkg',
    version: '1.0.0',
    maintainers: [{ name: 'alice' }],
    publishedAt: new Date(),
    createdAt: new Date(),
    latestVersion: '1.0.0',
    allVersions: ['1.0.0'],
    ...overrides,
  }
}

function makeGitHub(overrides: Partial<GitHubRepoData> = {}): GitHubRepoData {
  return {
    owner: 'test',
    repo: 'test-pkg',
    stars: 100,
    forks: 10,
    contributorCount: 5,
    lastCommitDate: new Date(),
    openIssues: 5,
    closedIssues: 50,
    isArchived: false,
    commitsLast12Months: 20,
    ...overrides,
  }
}

describe('detectMaintenanceIssues', () => {
  it('detects deprecated packages', () => {
    const metadata = makeMetadata({ deprecated: 'Use new-pkg instead' })
    const flags = detectMaintenanceIssues(metadata, 730)

    const deprecated = flags.find((f) => f.kind === 'deprecated')
    expect(deprecated).toBeDefined()
    if (deprecated?.kind === 'deprecated') {
      expect(deprecated.reason).toBe('Use new-pkg instead')
    }
  })

  it('detects unmaintained packages by last publish date', () => {
    const twoYearsAgo = new Date()
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 3)

    const metadata = makeMetadata({ publishedAt: twoYearsAgo })
    const flags = detectMaintenanceIssues(metadata, 730)

    const unmaintained = flags.find((f) => f.kind === 'unmaintained')
    expect(unmaintained).toBeDefined()
    if (unmaintained?.kind === 'unmaintained') {
      expect(unmaintained.daysSincePublish).toBeGreaterThan(730)
    }
  })

  it('does not flag recently published packages', () => {
    const metadata = makeMetadata({ publishedAt: new Date() })
    const flags = detectMaintenanceIssues(metadata, 730)

    expect(flags.find((f) => f.kind === 'unmaintained')).toBeUndefined()
  })

  it('flags archived repos even if recently published', () => {
    const metadata = makeMetadata({ publishedAt: new Date() })
    const github = makeGitHub({ isArchived: true })
    const flags = detectMaintenanceIssues(metadata, 730, github)

    const unmaintained = flags.find((f) => f.kind === 'unmaintained')
    expect(unmaintained).toBeDefined()
    if (unmaintained?.kind === 'unmaintained') {
      expect(unmaintained.isArchived).toBe(true)
    }
  })

  it('detects single maintainer', () => {
    const metadata = makeMetadata({ maintainers: [{ name: 'alice' }] })
    const flags = detectMaintenanceIssues(metadata, 730)

    const single = flags.find((f) => f.kind === 'single-maintainer')
    expect(single).toBeDefined()
    if (single?.kind === 'single-maintainer') {
      expect(single.npmMaintainerCount).toBe(1)
    }
  })

  it('enriches single-maintainer with GitHub contributor count', () => {
    const metadata = makeMetadata({ maintainers: [{ name: 'alice' }] })
    const github = makeGitHub({ contributorCount: 15 })
    const flags = detectMaintenanceIssues(metadata, 730, github)

    const single = flags.find((f) => f.kind === 'single-maintainer')
    if (single?.kind === 'single-maintainer') {
      expect(single.githubContributorCount).toBe(15)
    }
  })

  it('does not flag multiple maintainers', () => {
    const metadata = makeMetadata({
      maintainers: [{ name: 'alice' }, { name: 'bob' }],
    })
    const flags = detectMaintenanceIssues(metadata, 730)

    expect(flags.find((f) => f.kind === 'single-maintainer')).toBeUndefined()
  })
})

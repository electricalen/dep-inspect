import { describe, expect, it } from 'vitest'

import { parseGitHubRepo } from '../../../../src/adapters/github/repo-url-parser.js'

describe('parseGitHubRepo', () => {
  it('parses object form with https URL', () => {
    const result = parseGitHubRepo({
      type: 'git',
      url: 'https://github.com/lodash/lodash.git',
    })
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ owner: 'lodash', repo: 'lodash' })
  })

  it('parses object form with git+ prefix', () => {
    const result = parseGitHubRepo({
      type: 'git',
      url: 'git+https://github.com/facebook/react.git',
    })
    expect(result._unsafeUnwrap()).toEqual({ owner: 'facebook', repo: 'react' })
  })

  it('parses object form with ssh URL', () => {
    const result = parseGitHubRepo({
      type: 'git',
      url: 'git+ssh://git@github.com/user/repo.git',
    })
    expect(result._unsafeUnwrap()).toEqual({ owner: 'user', repo: 'repo' })
  })

  it('parses string URL', () => {
    const result = parseGitHubRepo('https://github.com/chalk/chalk')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'chalk', repo: 'chalk' })
  })

  it('parses shorthand github: prefix', () => {
    const result = parseGitHubRepo('github:user/repo')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'user', repo: 'repo' })
  })

  it('parses shorthand user/repo', () => {
    const result = parseGitHubRepo('user/repo')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'user', repo: 'repo' })
  })

  it('handles monorepo subpath', () => {
    const result = parseGitHubRepo('https://github.com/babel/babel/tree/main/packages/babel-core')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'babel', repo: 'babel' })
  })

  it('strips .git suffix', () => {
    const result = parseGitHubRepo('https://github.com/owner/repo.git')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('handles git:// protocol', () => {
    const result = parseGitHubRepo('git://github.com/owner/repo.git')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('returns error for non-GitHub URL', () => {
    const result = parseGitHubRepo('https://gitlab.com/user/repo')
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('Not a GitHub')
  })

  it('returns error for null/undefined', () => {
    const result = parseGitHubRepo(null)
    expect(result.isErr()).toBe(true)
  })

  it('returns error for empty object', () => {
    const result = parseGitHubRepo({})
    expect(result.isErr()).toBe(true)
  })

  it('handles owner with dots and hyphens', () => {
    const result = parseGitHubRepo('https://github.com/my-org.io/my-repo')
    expect(result._unsafeUnwrap()).toEqual({ owner: 'my-org.io', repo: 'my-repo' })
  })
})

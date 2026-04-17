import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseNpmLockfile } from '../../../../src/adapters/lockfile/npm.parser.js'
import type { FilePath } from '../../../../src/shared/types.js'

describe('parseNpmLockfile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-inspect-npm-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeLockfile(data: object): FilePath {
    const filePath = path.join(tmpDir, 'package-lock.json')
    fs.writeFileSync(filePath, JSON.stringify(data))
    return filePath as FilePath
  }

  it('parses a minimal v3 lockfile', () => {
    const fp = writeLockfile({
      lockfileVersion: 3,
      packages: {
        '': { name: 'my-app', version: '1.0.0' },
        'node_modules/lodash': {
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        },
        'node_modules/chalk': {
          version: '5.3.0',
          resolved: 'https://registry.npmjs.org/chalk/-/chalk-5.3.0.tgz',
        },
      },
    })

    const result = parseNpmLockfile(fp)
    expect(result.isOk()).toBe(true)

    const data = result._unsafeUnwrap()
    expect(data.type).toBe('npm')
    expect(data.packages.size).toBe(2)
    expect(data.packages.has('lodash@4.17.21')).toBe(true)
    expect(data.packages.has('chalk@5.3.0')).toBe(true)
  })

  it('handles scoped packages', () => {
    const fp = writeLockfile({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/@types/node': {
          version: '20.11.0',
          dev: true,
        },
      },
    })

    const result = parseNpmLockfile(fp)
    const data = result._unsafeUnwrap()
    expect(data.packages.has('@types/node@20.11.0')).toBe(true)

    const pkg = data.packages.get('@types/node@20.11.0')!
    expect(pkg.name).toBe('@types/node')
    expect(pkg.dev).toBe(true)
  })

  it('detects install scripts', () => {
    const fp = writeLockfile({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/better-sqlite3': {
          version: '11.0.0',
          hasInstallScript: true,
        },
      },
    })

    const result = parseNpmLockfile(fp)
    const data = result._unsafeUnwrap()
    const pkg = data.packages.get('better-sqlite3@11.0.0')!
    expect(pkg.hasInstallScript).toBe(true)
  })

  it('handles dependencies field', () => {
    const fp = writeLockfile({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/commander': {
          version: '12.0.0',
          dependencies: { 'some-dep': '^1.0.0' },
        },
      },
    })

    const result = parseNpmLockfile(fp)
    const data = result._unsafeUnwrap()
    const pkg = data.packages.get('commander@12.0.0')!
    expect(pkg.dependencies).toEqual({ 'some-dep': '^1.0.0' })
  })

  it('errors on missing packages field', () => {
    const fp = writeLockfile({ lockfileVersion: 1, dependencies: {} })

    const result = parseNpmLockfile(fp)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr().message).toContain('No "packages" field')
  })

  it('errors on invalid JSON', () => {
    const filePath = path.join(tmpDir, 'package-lock.json')
    fs.writeFileSync(filePath, 'not json')

    const result = parseNpmLockfile(filePath as FilePath)
    expect(result.isErr()).toBe(true)
  })

  it('handles nested node_modules', () => {
    const fp = writeLockfile({
      lockfileVersion: 3,
      packages: {
        '': {},
        'node_modules/a': { version: '1.0.0' },
        'node_modules/a/node_modules/b': { version: '2.0.0' },
      },
    })

    const result = parseNpmLockfile(fp)
    const data = result._unsafeUnwrap()
    expect(data.packages.has('a@1.0.0')).toBe(true)
    expect(data.packages.has('b@2.0.0')).toBe(true)
  })
})

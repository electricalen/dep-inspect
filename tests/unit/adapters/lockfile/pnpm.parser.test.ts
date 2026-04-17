import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parsePnpmLockfile } from '../../../../src/adapters/lockfile/pnpm.parser.js'
import type { FilePath } from '../../../../src/shared/types.js'

describe('parsePnpmLockfile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-inspect-pnpm-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeLockfile(content: string): FilePath {
    const filePath = path.join(tmpDir, 'pnpm-lock.yaml')
    fs.writeFileSync(filePath, content)
    return filePath as FilePath
  }

  it('reads dependency edges from snapshots in pnpm v9 lockfiles', () => {
    const fp = writeLockfile(`
lockfileVersion: '9.0'

packages:
  next@16.1.6:
    resolution:
      integrity: sha512-next
  ajv@6.12.6:
    resolution:
      integrity: sha512-ajv

snapshots:
  next@16.1.6:
    dependencies:
      ajv: 6.12.6
  ajv@6.12.6: {}
`)

    const result = parsePnpmLockfile(fp)
    expect(result.isOk()).toBe(true)

    const data = result._unsafeUnwrap()
    expect(data.type).toBe('pnpm')
    expect(data.packages.has('next@16.1.6')).toBe(true)
    expect(data.packages.has('ajv@6.12.6')).toBe(true)
    expect(data.packages.get('next@16.1.6')?.dependencies).toEqual({ ajv: '6.12.6' })
  })

  it('normalizes peer-suffixed snapshot keys to the base package version', () => {
    const fp = writeLockfile(`
lockfileVersion: '9.0'

packages:
  eslint@9.39.4:
    resolution:
      integrity: sha512-eslint
  '@humanwhocodes/module-importer@1.0.1':
    resolution:
      integrity: sha512-importer

snapshots:
  eslint@9.39.4(jiti@2.6.1):
    dependencies:
      '@humanwhocodes/module-importer': 1.0.1
  '@humanwhocodes/module-importer@1.0.1': {}
`)

    const result = parsePnpmLockfile(fp)
    expect(result.isOk()).toBe(true)

    const data = result._unsafeUnwrap()
    expect(data.packages.get('eslint@9.39.4')?.dependencies).toEqual({
      '@humanwhocodes/module-importer': '1.0.1',
    })
  })
})

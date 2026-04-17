import { describe, expect, it } from 'vitest'

import type { LockfileData } from '../../../../src/adapters/lockfile/lockfile.types.js'
import { buildDepGraph } from '../../../../src/core/graph/graph.builder.js'

describe('buildDepGraph edge resolution', () => {
  it('links to the correct child when two versions of the same package exist', () => {
    const lockfile: LockfileData = {
      type: 'npm',
      packages: new Map([
        [
          'root@1.0.0',
          {
            name: 'root',
            version: '1.0.0',
            dev: false,
            optional: false,
            hasInstallScript: false,
            dependencies: { foo: '1.0.0' },
          },
        ],
        [
          'foo@1.0.0',
          {
            name: 'foo',
            version: '1.0.0',
            dev: false,
            optional: false,
            hasInstallScript: false,
          },
        ],
        [
          'foo@2.0.0',
          {
            name: 'foo',
            version: '2.0.0',
            dev: false,
            optional: false,
            hasInstallScript: false,
          },
        ],
      ]),
    }

    const graph = buildDepGraph(lockfile, {
      dependencies: { root: '1.0.0' },
    })

    const rootKey = 'root@1.0.0'
    const children = graph.childrenOf(rootKey)
    expect(children).toEqual(['foo@1.0.0'])
  })
})

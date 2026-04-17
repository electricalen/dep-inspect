import { describe, expect, it } from 'vitest'

import { resolveRangeToVersion } from '../../../../src/core/graph/registry-tree.builder.js'

describe('resolveRangeToVersion', () => {
  const versions = ['1.0.0', '1.1.0', '2.0.0', '2.0.0-beta.1']

  it('resolves caret ranges', () => {
    expect(resolveRangeToVersion('^1.0.0', versions)).toBe('1.1.0')
    expect(resolveRangeToVersion('^2.0.0', versions)).toBe('2.0.0')
  })

  it('resolves exact versions', () => {
    expect(resolveRangeToVersion('1.1.0', versions)).toBe('1.1.0')
  })

  it('returns null for non-registry specs', () => {
    expect(resolveRangeToVersion('workspace:*', versions)).toBe(null)
    expect(resolveRangeToVersion('file:../foo', versions)).toBe(null)
  })
})

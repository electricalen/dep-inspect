import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOsvAdapter } from '../../../src/adapters/osv.adapter.js'

const OSV_URL = 'https://api.osv.dev/v1/query'

function mockFetchJson(status: number, body: unknown) {
  return vi.fn((url: string | URL, init?: RequestInit) => {
    expect(String(url)).toBe(OSV_URL)
    expect(init?.method).toBe('POST')
    const payload = JSON.parse(init?.body as string) as {
      version: string
      package: { name: string; ecosystem: string }
    }
    expect(payload.package.ecosystem).toBe('npm')
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

describe('createOsvAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty advisories when OSV reports no vulns', async () => {
    vi.stubGlobal('fetch', mockFetchJson(200, { vulns: [] }))

    const result = await createOsvAdapter().query('safe-pkg', '1.0.0')

    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([])
  })

  it('omits vulns key as empty list', async () => {
    vi.stubGlobal('fetch', mockFetchJson(200, {}))

    const result = await createOsvAdapter().query('safe-pkg', '2.0.0')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value).toEqual([])
  })

  it('maps CVSS_V3 score to severity buckets', async () => {
    const mk = (id: string, score: string) => ({
      id,
      summary: `sev ${score}`,
      severity: [{ type: 'CVSS_V3', score }],
      affected: [{ ranges: [{ events: [{ fixed: '2.0.0' }] }] }],
    })
    vi.stubGlobal(
      'fetch',
      mockFetchJson(200, {
        vulns: [mk('CRIT', '9.0'), mk('HIGH', '7.0'), mk('MED', '4.0'), mk('LOW', '3.9')],
      }),
    )

    const result = await createOsvAdapter().query('pkg', '1.0.0')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return

    expect(result.value.map((a) => [a.id, a.severity, a.fixAvailable])).toEqual([
      ['CRIT', 'critical', true],
      ['HIGH', 'high', true],
      ['MED', 'medium', true],
      ['LOW', 'low', true],
    ])
    expect(result.value.every((a) => a.affectedVersions === '1.0.0')).toBe(true)
  })

  it('maps database_specific.severity when CVSS is absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson(200, {
        vulns: [
          {
            id: 'GHSA-db',
            summary: 'from npm advisory',
            database_specific: { severity: 'HIGH' },
            affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '1.1.0' }] }] }],
          },
        ],
      }),
    )

    const result = await createOsvAdapter().query('some-pkg', '1.0.0')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value[0]).toMatchObject({
      id: 'GHSA-db',
      severity: 'high',
      fixAvailable: true,
      summary: 'from npm advisory',
      affectedVersions: '1.0.0',
    })
  })

  it('defaults severity to medium when no scores are present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchJson(200, {
        vulns: [{ id: 'OSV-UNDEFINED', summary: undefined, affected: [] }],
      }),
    )

    const result = await createOsvAdapter().query('x', '0.0.1')
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) return
    expect(result.value[0]).toMatchObject({
      id: 'OSV-UNDEFINED',
      summary: 'No description available',
      severity: 'medium',
      fixAvailable: false,
    })
  })

  it('sends package name and version in the query body', async () => {
    const fetchMock = mockFetchJson(200, { vulns: [] })
    vi.stubGlobal('fetch', fetchMock)

    await createOsvAdapter().query('@scope/foo', '3.2.1')

    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(init!.body as string) as {
      version: string
      package: { name: string; ecosystem: string }
    }
    expect(body).toEqual({
      version: '3.2.1',
      package: { name: '@scope/foo', ecosystem: 'npm' },
    })
  })

  it('returns Err when HTTP status is not ok', async () => {
    vi.stubGlobal('fetch', mockFetchJson(503, { error: 'unavailable' }))

    const result = await createOsvAdapter().query('pkg', '1.0.0')
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) return
    expect(result.error.kind).toBe('vulnerability')
    expect(result.error.message).toContain('503')
  })
})

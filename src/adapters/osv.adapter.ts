import { ResultAsync } from 'neverthrow'

import type { VulnerabilityError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'
import type { VulnerabilityAdvisory, VulnerabilityPort } from '../ports/vulnerability.port.js'

const OSV_API = 'https://api.osv.dev/v1/query'

interface OsvResponse {
  vulns?: OsvVulnerability[]
}

interface OsvVulnerability {
  id: string
  summary?: string
  severity?: { type: string; score: string }[]
  database_specific?: { severity?: string }
  affected?: {
    ranges?: {
      events?: { fixed?: string }[]
    }[]
  }[]
}

function classifySeverity(vuln: OsvVulnerability): 'critical' | 'high' | 'medium' | 'low' {
  // Check CVSS severity
  const cvss = vuln.severity?.find((s) => s.type === 'CVSS_V3')
  if (cvss) {
    const score = parseFloat(cvss.score)
    if (score >= 9.0) return 'critical'
    if (score >= 7.0) return 'high'
    if (score >= 4.0) return 'medium'
    return 'low'
  }

  // Check database-specific severity
  const dbSeverity = vuln.database_specific?.severity?.toLowerCase()
  if (dbSeverity === 'critical') return 'critical'
  if (dbSeverity === 'high') return 'high'
  if (dbSeverity === 'moderate' || dbSeverity === 'medium') return 'medium'
  if (dbSeverity === 'low') return 'low'

  return 'medium' // Default
}

function hasFixAvailable(vuln: OsvVulnerability): boolean {
  if (!vuln.affected) return false

  for (const affected of vuln.affected) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) return true
      }
    }
  }

  return false
}

/**
 * Create an OSV Database adapter for vulnerability queries.
 */
export function createOsvAdapter(): VulnerabilityPort {
  return {
    query(
      packageName: string,
      version: string,
    ): ResultAsync<readonly VulnerabilityAdvisory[], VulnerabilityError> {
      return ResultAsync.fromPromise(
        (async () => {
          logger.debug(`Querying OSV for ${packageName}@${version}`)

          const response = await fetch(OSV_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              version,
              package: { name: packageName, ecosystem: 'npm' },
            }),
          })

          if (!response.ok) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw {
              kind: 'vulnerability' as const,
              message: `OSV API returned HTTP ${response.status}`,
              statusCode: response.status,
            }
          }

          const data = (await response.json()) as OsvResponse
          const vulns = data.vulns ?? []

          return vulns.map(
            (vuln): VulnerabilityAdvisory => ({
              id: vuln.id,
              summary: vuln.summary ?? 'No description available',
              severity: classifySeverity(vuln),
              fixAvailable: hasFixAvailable(vuln),
              affectedVersions: version,
            }),
          )
        })(),
        (error): VulnerabilityError => {
          if (typeof error === 'object' && error !== null && 'kind' in error) {
            return error as VulnerabilityError
          }
          return {
            kind: 'vulnerability',
            message: error instanceof Error ? error.message : String(error),
          }
        },
      )
    },
  }
}

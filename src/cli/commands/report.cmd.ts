import * as fs from 'node:fs'
import * as path from 'node:path'

import { analyzeProject } from '../../core/analysis/project.analyzer.js'
import { formatError } from '../../shared/errors.js'
import { logger } from '../../shared/logger.js'
import { EXIT_CODES } from '../../shared/types.js'
import { formatScan } from '../formatters/human.formatter.js'
import { formatScanJson } from '../formatters/json.formatter.js'
import { createAdapters } from './shared.js'

interface ReportOptions {
  readonly json: boolean
  readonly github: boolean
  readonly strict: boolean
}

/**
 * `dep-inspect report` — generate a full dependency risk report.
 * Same data as scan, but defaults to JSON output.
 */
export async function reportCommand(opts: ReportOptions): Promise<void> {
  const projectDir = process.cwd()
  const packageJson = readPackageJson(projectDir)

  if (!packageJson) {
    logger.error('No package.json found in current directory')
    process.exitCode = EXIT_CODES.toolError
    return
  }

  const { registry, vulnerability, lockfile, github, policy, cleanup } = createAdapters({
    github: opts.github,
    strict: opts.strict,
  })

  try {
    const result = analyzeProject(projectDir, packageJson, {
      registry,
      vulnerability,
      lockfile,
      github,
      policy,
    })

    if (result.isErr()) {
      logger.error(formatError(result.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    const analysis = await result.value
    if (analysis.isErr()) {
      logger.error(formatError(analysis.error))
      process.exitCode = EXIT_CODES.toolError
      return
    }

    if (opts.json) {
      console.log(formatScanJson(analysis.value, policy))
    } else {
      console.log(formatScan(analysis.value, policy, { details: true }))
    }
  } finally {
    cleanup()
  }
}

function readPackageJson(dir: string): Record<string, unknown> | null {
  const filePath = path.join(dir, 'package.json')
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

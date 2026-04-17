import * as fs from 'node:fs'
import * as path from 'node:path'

import { err, ok, type Result } from 'neverthrow'

import type { PolicyParseError } from '../shared/errors.js'
import { parseFilePath, type FilePath } from '../shared/types.js'
import type { PolicyConfig } from '../core/policy/policy.types.js'
import { policyConfigSchema } from '../core/policy/policy.schema.js'
import { DEFAULT_POLICY } from './config.defaults.js'

const CONFIG_FILENAMES = ['.dep-inspect.json', '.dep-inspect.jsonc'] as const

/**
 * Search for a config file starting from `startDir` and walking up to root.
 */
function findConfigFile(startDir: string): FilePath | null {
  let dir = startDir

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const filePath = path.join(dir, filename)
      if (fs.existsSync(filePath)) {
        const result = parseFilePath(filePath)
        if (result.isOk()) return result.value
      }
    }

    const parent = path.dirname(dir)
    if (parent === dir) break // Reached filesystem root
    dir = parent
  }

  return null
}

/**
 * Load and validate a policy config file.
 * Returns the default policy if no config file is found.
 */
export function loadPolicyConfig(startDir?: string): Result<PolicyConfig, PolicyParseError> {
  const dir = startDir ?? process.cwd()
  const configPath = findConfigFile(dir)

  if (!configPath) {
    return ok(DEFAULT_POLICY)
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')

    // Strip JSONC comments (single-line only)
    const stripped = raw.replace(/\/\/.*$/gm, '')

    const parsed: unknown = JSON.parse(stripped)
    const validated = policyConfigSchema.safeParse(parsed)

    if (!validated.success) {
      const issues = validated.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      return err({
        kind: 'policy-parse',
        message: `Invalid config:\n${issues}`,
        filePath: configPath,
      })
    }

    // Merge with defaults (validated config takes precedence)
    const config: PolicyConfig = {
      severity: { ...DEFAULT_POLICY.severity, ...validated.data.severity },
      licenses: {
        allow:
          validated.data.licenses.allow.length > 0
            ? validated.data.licenses.allow
            : DEFAULT_POLICY.licenses.allow,
        deny:
          validated.data.licenses.deny.length > 0
            ? validated.data.licenses.deny
            : DEFAULT_POLICY.licenses.deny,
        unknown: validated.data.licenses.unknown,
      },
      ci: validated.data.ci,
      cache: validated.data.cache as PolicyConfig['cache'],
      waivers: validated.data.waivers as PolicyConfig['waivers'],
    }

    return ok(config)
  } catch (error) {
    return err({
      kind: 'policy-parse',
      message: error instanceof Error ? error.message : String(error),
      filePath: configPath,
    })
  }
}

import * as fs from 'node:fs'
import * as path from 'node:path'

import { logger } from '../../shared/logger.js'

const CONFIG_FILENAME = '.dep-inspect.json'

const DEFAULT_CONFIG = {
  severity: {
    vulnerability: 'critical',
    deprecated: 'critical',
    'license-violation': 'critical',
    'install-scripts': 'warning',
    unmaintained: { level: 'warning', thresholdDays: 730 },
    'single-maintainer': 'off',
    'license-risk': 'off',
    'dependency-footprint': 'off',
    'missing-repository': 'off',
    'version-risk': 'off',
  },
  licenses: {
    allow: [
      '0BSD',
      'AFL-3.0',
      'Apache-2.0',
      'Artistic-2.0',
      'BlueOak-1.0.0',
      'BSD-1-Clause',
      'BSD-2-Clause',
      'BSD-2-Clause-Patent',
      'BSD-3-Clause',
      'BSL-1.0',
      'CC0-1.0',
      'ECL-2.0',
      'EPL-2.0',
      'EUPL-1.1',
      'EUPL-1.2',
      'ISC',
      'LGPL-2.1-only',
      'LGPL-2.1-or-later',
      'LGPL-3.0-only',
      'LGPL-3.0-or-later',
      'MIT',
      'MIT-0',
      'MPL-2.0',
      'NCSA',
      'PostgreSQL',
      'PSF-2.0',
      'Python-2.0',
      'Unlicense',
      'Zlib',
    ],
    deny: [
      'AGPL-3.0',
      'AGPL-3.0-only',
      'AGPL-3.0-or-later',
      'BUSL-1.1',
      'CC-BY-NC-4.0',
      'CC-BY-NC-ND-4.0',
      'CC-BY-NC-SA-4.0',
      'CC-BY-ND-4.0',
      'Commons-Clause',
      'Elastic-2.0',
      'GPL-2.0',
      'GPL-2.0-only',
      'GPL-2.0-or-later',
      'GPL-3.0',
      'GPL-3.0-only',
      'GPL-3.0-or-later',
      'PolyForm-Noncommercial-1.0.0',
      'Prosperity-3.0.0',
      'SSPL-1.0',
    ],
    unknown: 'warning',
  },
  ci: {
    failOn: 'critical',
  },
  waivers: [],
}

interface InitOptions {
  readonly force: boolean
}

/**
 * `dep-inspect init` — generate a default config file.
 */
export function initCommand(opts: InitOptions): void {
  const filePath = path.join(process.cwd(), CONFIG_FILENAME)

  if (fs.existsSync(filePath) && !opts.force) {
    logger.error(`${CONFIG_FILENAME} already exists. Use --force to overwrite.`)
    process.exitCode = 1
    return
  }

  const content = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n'
  fs.writeFileSync(filePath, content, 'utf-8')
  logger.info(`Created ${CONFIG_FILENAME}`)
}

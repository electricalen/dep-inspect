import type { PackageMetadata } from '../../../ports/registry.port.js'
import type { Flag } from '../flag.types.js'

/** Install-related script names that indicate potential supply chain risk. */
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const

/**
 * Detect supply chain risk flags: install scripts.
 *
 * Pure function — no I/O.
 */
export function detectSupplyChainIssues(metadata: PackageMetadata): Flag[] {
  const flags: Flag[] = []

  if (metadata.scripts) {
    const foundScripts: string[] = []

    for (const scriptName of INSTALL_SCRIPTS) {
      if (metadata.scripts[scriptName]) {
        foundScripts.push(scriptName)
      }
    }

    if (foundScripts.length > 0) {
      flags.push({
        kind: 'install-scripts',
        scripts: foundScripts,
      })
    }
  }

  return flags
}

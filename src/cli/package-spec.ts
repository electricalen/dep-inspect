/**
 * Parse a package spec like "lodash" or "lodash@4.17.21" into name + version.
 * Handles scoped packages: @scope/name@version
 */
export function parsePackageSpec(spec: string): { name: string; version: string | undefined } {
  if (spec.startsWith('@')) {
    const slashIdx = spec.indexOf('/')
    if (slashIdx === -1) return { name: spec, version: undefined }

    const afterSlash = spec.slice(slashIdx + 1)
    const atIdx = afterSlash.indexOf('@')
    if (atIdx === -1) return { name: spec, version: undefined }

    return {
      name: spec.slice(0, slashIdx + 1 + atIdx),
      version: afterSlash.slice(atIdx + 1),
    }
  }

  const atIdx = spec.indexOf('@')
  if (atIdx === -1) return { name: spec, version: undefined }

  return {
    name: spec.slice(0, atIdx),
    version: spec.slice(atIdx + 1),
  }
}

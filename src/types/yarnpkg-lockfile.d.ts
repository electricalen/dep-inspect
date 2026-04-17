declare module '@yarnpkg/lockfile' {
  export function parse(input: string): {
    type: 'success' | 'merge' | 'conflict'
    object: Record<
      string,
      {
        version: string
        resolved?: string
        integrity?: string
        dependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
      }
    >
  }
}

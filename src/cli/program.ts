import { Command } from 'commander'
import packageJson from '../../package.json'

import { cacheClearCommand, cacheStatsCommand } from './commands/cache.cmd.js'
import { ciCommand } from './commands/ci.cmd.js'
import { deepInspectCommand } from './commands/deep-inspect.cmd.js'
import { initCommand } from './commands/init.cmd.js'
import { inspectCommand } from './commands/inspect.cmd.js'
import { reportCommand } from './commands/report.cmd.js'
import { scanCommand } from './commands/scan.cmd.js'

export function createProgram(): Command {
  const program = new Command()
    .name('dep-inspect')
    .description('Analyze npm dependencies for risk signals and enforce policy')
    .version(packageJson.version)

  program
    .command('inspect <package>')
    .description('Inspect a single package before installing it')
    .option('--no-github', 'Skip GitHub repository data')
    .option('--strict', 'Enable heuristic-heavy checks and extra context')
    .option('--json', 'Output as JSON')
    .action((pkg: string, opts: { github: boolean; strict: boolean; json: boolean }) => {
      return inspectCommand(pkg, opts)
    })

  program
    .command('deep-inspect <package>')
    .description(
      'Inspect a package and its transitive dependencies (registry-resolved; same signals as scan)',
    )
    .option('--github', 'Include GitHub repository data')
    .option('--details', 'Show the full dependency breakdown')
    .option('--strict', 'Enable heuristic-heavy checks and extra context')
    .option('--json', 'Output as JSON')
    .action(
      (
        pkg: string,
        opts: { github: boolean; details: boolean; strict: boolean; json: boolean },
      ) => {
        return deepInspectCommand(pkg, opts)
      },
    )

  program
    .command('scan')
    .description('Scan current project dependencies for actionable risk signals')
    .option('--github', 'Include GitHub repository data')
    .option('--details', 'Show the full dependency breakdown')
    .option('--strict', 'Enable heuristic-heavy checks and extra context')
    .option('--json', 'Output as JSON')
    .action((opts: { github: boolean; details: boolean; strict: boolean; json: boolean }) => {
      return scanCommand(opts)
    })

  program
    .command('ci')
    .description('CI gatekeeper — exits non-zero on policy violations')
    .option('--github', 'Include GitHub repository data')
    .option('--strict', 'Enable heuristic-heavy checks and extra context')
    .option('--format <format>', 'Output format (text, json)', 'text')
    .action((opts: { github: boolean; strict: boolean; format: string }) => {
      return ciCommand(opts)
    })

  program
    .command('report')
    .description('Generate a detailed dependency risk report')
    .option('--json', 'Output as JSON')
    .option('--github', 'Include GitHub repository data')
    .option('--strict', 'Enable heuristic-heavy checks and extra context')
    .action((opts: { json: boolean; github: boolean; strict: boolean }) => {
      return reportCommand(opts)
    })

  program
    .command('init')
    .description('Generate a default .dep-inspect.json config file')
    .option('--force', 'Overwrite existing config file')
    .action((opts: { force: boolean }) => {
      initCommand(opts)
    })

  const cache = program.command('cache').description('Manage the dep-inspect cache')

  cache
    .command('clear')
    .description('Clear all cached data')
    .action(() => {
      cacheClearCommand()
    })

  cache
    .command('stats')
    .description('Show cache statistics')
    .action(() => {
      cacheStatsCommand()
    })

  return program
}

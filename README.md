# dep-inspect

`dep-inspect` catches risky npm packages before they land in your project.

It is a local-first CLI for two common workflows:

- check a package before you install it
- fail CI when dependencies trip high-confidence risk checks

The default experience is intentionally narrow and fast to read. It focuses on high-confidence, actionable signals first, and keeps heuristic-heavy checks behind `--strict`.

## What `inspect` Checks

`dep-inspect inspect <package>` analyzes one package version before you install it.

By default it checks:

- known vulnerabilities from OSV
- maintainer deprecation notices
- license policy violations, including missing licenses
- install-time scripts: `preinstall`, `install`, `postinstall`, and `prepare`
- maintenance risk based on publish age

`inspect` includes GitHub repository data by default when the package metadata points to a GitHub repo. That means it can also use repository health data such as archived status and contributor counts in the output for a single package review.

## What `scan` Checks

`dep-inspect scan` analyzes the dependencies in the current project by reading `package.json` and the lockfile, then evaluating each unique package in the resolved dependency graph.

By default it checks the same policy-backed package signals as `inspect` across your dependency tree:

- vulnerabilities
- deprecated packages
- license violations
- install-time scripts
- unmaintained packages based on age since last publish

By default, `scan` does not fetch GitHub data. Use `--github` when you want repository-backed maintenance context such as archived repositories.

## Optional Strict Mode

If you want more context, `--strict` enables additional lower-confidence or more heuristic-heavy signals:

- single maintainer warnings
- unusual or non-standard license risk warnings
- missing repository metadata notes
- version lag or prerelease notes
- dependency footprint notes for large or deeply nested trees

Those checks are useful in some teams, but they are intentionally not part of the standard path.

## Severity Model

`dep-inspect` uses three severity tiers instead of a single opaque score:

- `critical`: immediate action recommended; blocks CI by default
- `warning`: review recommended; may block CI if your policy says so
- `info`: context for human decision-making; does not block CI by default

Default policy severity is:

- `critical`: high/critical vulnerabilities, deprecated packages, license violations
- `warning`: install scripts, unmaintained packages
- `off` by default unless enabled with `--strict` or policy overrides: single maintainer, license risk, dependency footprint, missing repository, version risk

Vulnerability findings are severity-aware:

- high/critical advisories stay `critical`
- medium advisories become `warning`
- low advisories become `warning` for direct dependencies and `info` for transitives
- transitive issues are still scanned, but they are capped at `warning` by default and shown under the direct dependency that introduces them
- by default, only direct dependency findings can block because non-direct findings are capped at `warning`

The reasoning behind those defaults is simple:

- `critical` is reserved for signals with a direct security, legal, or maintenance stop-ship implication
- `warning` is used for signals that are often legitimate but deserve review before adoption
- `info` is used for contextual signals that may matter to some teams but are too heuristic-heavy to fail builds by default

## Why Use It

- more practical dependency triage than `npm audit` alone
- no SaaS account required
- good fit for preinstall review and lightweight CI policy
- JSON output for automation
- SQLite cache for fast repeat scans

## Installation

If the package is published to npm:

```bash
npx dep-inspect inspect lodash
```

Or install globally:

```bash
npm install -g dep-inspect
dep-inspect --help
```

From source:

```bash
pnpm install
pnpm build
node dist/index.js --help
```

Before publishing a release from source, run:

```bash
pnpm release:check
```

## Quick Start

Inspect a package before adding it:

```bash
dep-inspect inspect eslint
```

Enable heuristic-heavy checks when you want a stricter review:

```bash
dep-inspect inspect eslint --strict
```

Scan the current project:

```bash
dep-inspect scan
```

Show the full package-by-package breakdown:

```bash
dep-inspect scan --details
```

Use it in CI:

```bash
dep-inspect ci --github
```

Generate a starter policy file:

```bash
dep-inspect init
```

## Commands

| Command                  | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `inspect <package>`      | Quick package review before installation                |
| `scan`                   | Concise project dependency scan                         |
| `ci`                     | Policy gate for pipelines                               |
| `report`                 | Detailed dependency report                              |
| `deep-inspect <package>` | Registry-resolved transitive inspection for one package |
| `init`                   | Create `.dep-inspect.json`                              |
| `cache stats`            | Show cache statistics                                   |
| `cache clear`            | Clear cached data                                       |

Useful flags:

- `--details`: show the full breakdown instead of the concise default summary
- `--strict`: enable heuristic-heavy checks and extra context
- `--github`: include GitHub repository health data where supported
- `--json`: emit machine-readable output

## Output Philosophy

The default output is optimized for fast triage:

- one verdict
- a short list of packages to review first
- enough context to decide whether to keep investigating

If you want every category and package detail, use `--details`.

## Why a Package Gets Flagged

Flags are evidence-based and category-specific rather than score-based.

- Vulnerability: OSV returned one or more advisories for the exact package version; the reported severity is derived from the highest advisory severity and whether the package is direct or transitive
- Deprecated: the npm package metadata includes a maintainer deprecation notice
- License violation: the package license is denied, missing, or not allowed by policy
- Install scripts: the package runs install lifecycle scripts that execute during dependency installation
- Unmaintained: the latest publish date is older than the configured threshold, or the GitHub repo is archived when GitHub data is enabled
- Single maintainer: the package has one or zero npm maintainers
- License risk: the license is uncommon or non-standard rather than explicitly denied
- Missing repository: the package does not provide a usable repository link
- Version risk: the inspected version is a prerelease or at least two major versions behind latest
- Dependency footprint: the resolved tree is unusually large, deep, or duplicated

## Example Policy File

Run `dep-inspect init` to generate a starter config:

```json
{
  "severity": {
    "vulnerability": "critical",
    "deprecated": "critical",
    "license-violation": "critical",
    "install-scripts": "warning",
    "unmaintained": { "level": "warning", "thresholdDays": 730 },
    "single-maintainer": "off",
    "license-risk": "off",
    "dependency-footprint": "off",
    "missing-repository": "off",
    "version-risk": "off"
  },
  "licenses": {
    "allow": [
      "0BSD",
      "AFL-3.0",
      "Apache-2.0",
      "Artistic-2.0",
      "BlueOak-1.0.0",
      "BSD-1-Clause",
      "BSD-2-Clause",
      "BSD-2-Clause-Patent",
      "BSD-3-Clause",
      "BSL-1.0",
      "CC0-1.0",
      "ECL-2.0",
      "EPL-2.0",
      "EUPL-1.1",
      "EUPL-1.2",
      "ISC",
      "LGPL-2.1-only",
      "LGPL-2.1-or-later",
      "LGPL-3.0-only",
      "LGPL-3.0-or-later",
      "MIT",
      "MIT-0",
      "MPL-2.0",
      "NCSA",
      "PostgreSQL",
      "PSF-2.0",
      "Python-2.0",
      "Unlicense",
      "Zlib"
    ],
    "deny": [
      "AGPL-3.0",
      "AGPL-3.0-only",
      "AGPL-3.0-or-later",
      "BUSL-1.1",
      "CC-BY-NC-4.0",
      "CC-BY-NC-ND-4.0",
      "CC-BY-NC-SA-4.0",
      "CC-BY-ND-4.0",
      "Commons-Clause",
      "Elastic-2.0",
      "GPL-2.0",
      "GPL-2.0-only",
      "GPL-2.0-or-later",
      "GPL-3.0",
      "GPL-3.0-only",
      "GPL-3.0-or-later",
      "PolyForm-Noncommercial-1.0.0",
      "Prosperity-3.0.0",
      "SSPL-1.0"
    ],
    "unknown": "warning"
  },
  "ci": {
    "failOn": "critical"
  },
  "waivers": []
}
```

## CI Usage

`dep-inspect ci` exits with:

- `0` when policy passes
- `1` when policy fails
- `2` when the tool cannot complete

Example GitHub Actions step:

```yaml
- name: Audit dependencies
  run: pnpm exec dep-inspect ci --github
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Development

Requirements:

- Node.js 20 or newer
- pnpm 10 or newer

Local workflow:

```bash
pnpm install
pnpm validate
pnpm build
```

Useful commands:

```bash
pnpm dev inspect lodash
pnpm dev scan --details
pnpm test:coverage
```

## Architecture

The project uses ports and adapters with pure detectors and thin I/O integrations.

Key design notes:

1. [Result types over exceptions](docs/adr/001-result-types-over-exceptions.md)
2. [Ports and adapters](docs/adr/002-ports-and-adapters.md)
3. [Flag detection as pure functions](docs/adr/003-flag-detection-as-pure-functions.md)
4. [Severity tiers over scores](docs/adr/004-severity-tiers-over-scores.md)
5. [SQLite cache](docs/adr/005-sqlite-cache.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Issue and pull request templates are provided under `.github/` to keep bug reports, feature requests, and review context consistent.

## Security

See [SECURITY.md](SECURITY.md) before reporting vulnerabilities.

## License

MIT. See [LICENSE](LICENSE).

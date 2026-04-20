# Contributing to dep-inspect

Thanks for contributing. This project is intended to stay small, reviewable, and reliable, so changes should optimize for correctness, clarity, and predictable CLI behavior.

## Before You Start

- Search existing issues and pull requests before opening new work
- Prefer small, focused pull requests over large refactors
- Include tests for behavior changes
- Update documentation when command behavior, config, or output changes

## Development Setup

Requirements:

- Node.js 20 or newer
- pnpm 10 or newer

Setup:

```bash
pnpm install
pnpm build
pnpm validate
```

Release maintainers should run:

```bash
pnpm release:check
```

User-facing changes should also include a changeset:

```bash
pnpm changeset
```

Run the CLI locally:

```bash
pnpm dev --help
pnpm dev inspect lodash
pnpm dev scan
```

## Local Hooks and Commit Messages

This repository installs Git hooks through Husky when you run `pnpm install`.

- `pre-commit` runs `pnpm lint-staged`
- `commit-msg` runs `pnpm commitlint --edit <commit-message-file>`

### Commit Message Format

Commit messages must follow the Conventional Commits format enforced by `@commitlint/config-conventional`:

```text
type(scope): short imperative summary
```

Examples:

- `feat(cli): add JSON formatter for scan output`
- `fix(lockfile): handle npm alias dependencies`
- `docs(contributing): clarify commit message requirements`
- `test(graph): cover edge resolution regression`

Use a lowercase commit type such as:

- `feat`
- `fix`
- `docs`
- `refactor`
- `test`
- `chore`
- `build`
- `ci`

Guidance for the subject line:

- Keep it short and specific
- Write it in the imperative mood
- Describe the resulting change, not the work you did
- Use a scope when it helps reviewers understand the area that changed

If commitlint rejects a message, rewrite the subject to match the format above before pushing.

### What the Pre-commit Hook Changes

`lint-staged` automatically fixes and formats staged files before the commit is created:

- `*.ts`: `eslint --fix` and `prettier --write`
- `*.json`, `*.md`, `*.yml`, `*.yaml`: `prettier --write`

Review the staged diff after the hook runs. If the hook rewrites files, re-stage them before retrying the commit.

## Project Structure

- `src/cli`: command definitions and output formatters
- `src/core`: analysis logic, graph building, policy evaluation, and detectors
- `src/adapters`: integrations for npm, OSV, GitHub, cache, and lockfiles
- `src/config`: config loading and defaults
- `src/shared`: shared types, error handling, logging, and utilities
- `tests/unit`: unit tests by subsystem
- `docs/adr`: architecture decision records

## Contribution Workflow

1. Open an issue for larger changes or behavior changes that may affect policy semantics.
2. Create a focused branch.
3. Add or update tests with the implementation.
4. Add a changeset with `pnpm changeset` when the change should affect the published package version or changelog.
5. Run the required local checks.
6. Update documentation if users will notice the change.
7. Open a pull request with a clear description of the problem, approach, and tradeoffs.

## Code Guidelines

- Keep detectors pure when possible
- Keep adapters thin and explicit about external I/O
- Prefer small, composable functions over broad abstractions
- Preserve strict TypeScript typing
- Do not leave unused variables or parameters unless they are intentionally prefixed with `_`
- Avoid hidden behavior in CLI commands; defaults should be documented
- Do not introduce network dependencies into tests unless they are fully mocked
- Format code with Prettier and keep lint output clean before opening a pull request
- Follow existing ports-and-adapters boundaries instead of introducing cross-layer shortcuts

## Testing Expectations

Before opening a pull request, run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

`pnpm validate` is still a useful shortcut, but it only runs:

```bash
pnpm typecheck && pnpm lint && pnpm test:run
```

CI enforces more than `pnpm validate`:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` on Node.js 20 and Node.js 22
- `pnpm build`
- `node dist/index.js --help` as a smoke test

Run the full set locally when your change could affect packaging, generated output, or CLI startup behavior.

Add tests when changing:

- detector behavior
- CLI flags or output
- config schema or defaults
- lockfile parsing
- adapter error handling

## Documentation Expectations

Update the relevant docs when changing:

- command names, flags, or examples in `README.md`
- contributor workflow in `CONTRIBUTING.md`
- security reporting guidance in `SECURITY.md`
- architectural direction in `docs/adr/`

## Pull Request Checklist

- The change is scoped and reviewable
- Tests cover the new or changed behavior
- A changeset is included for user-facing package changes
- Required local checks pass locally
- Documentation is updated where needed
- Breaking changes are clearly called out

## Release Process

This repository does not publish on every merge to `main`.

- Every pull request into `main` runs CI only
- Releasable pull requests should include a changeset
- A GitHub Actions release workflow collects pending changesets into a dedicated release PR
- Only merging that release PR publishes to npm
- The release merge also creates the version tag, updates `CHANGELOG.md`, and creates the GitHub Release

This keeps day-to-day commits flowing while making releases explicit, reviewable, and reproducible.

The full maintainer runbook, provenance notes, and user verification steps are documented in [RELEASING.md](./RELEASING.md).

## Reporting Bugs

Use the GitHub issue templates for bug reports and feature requests when they are available.

Open an issue with:

- what you ran
- what you expected
- what happened instead
- Node.js version
- package manager and lockfile type
- whether `--github` was enabled

If the bug may expose a security issue, use the process in `SECURITY.md` instead of opening a public issue.

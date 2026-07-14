# AGENTS.md

## Cursor Cloud specific instructions

This is a TypeScript CLI tool (`dep-inspect`) using pnpm. No Docker, no databases, no external services required for development.

### Quick reference

- **Dev commands:** see `scripts` in `package.json` and `CONTRIBUTING.md`
- **Run CLI locally:** `pnpm dev <command>` (e.g. `pnpm dev inspect lodash`, `pnpm dev scan`)
- **Full validation:** `pnpm validate` (typecheck + lint + test)
- **CI-equivalent checks:** `pnpm format:check && pnpm typecheck && pnpm lint && pnpm test:run && pnpm build && node dist/index.js --help`

### Non-obvious notes

- `better-sqlite3` is a native addon. If `pnpm install` fails on it, check that build tools (`python3`, `make`, `g++`) are available. The `pnpm.onlyBuiltDependencies` allowlist in `package.json` already covers `better-sqlite3` and `esbuild`.
- Commit messages must follow Conventional Commits format (enforced by commitlint via Husky `commit-msg` hook). Use types like `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
- The `pre-commit` hook runs `lint-staged` which auto-fixes and formats staged `.ts` files with ESLint + Prettier. If it rewrites files, you must re-stage them before retrying the commit.
- All tests are fully mocked with no network dependencies. `pnpm test:run` runs the full suite without external access.
- The project uses ESM (`"type": "module"` in `package.json`). Imports must use `.js` extensions for local files.
- `.npmrc` sets `strict-peer-dependencies=true`; peer dependency mismatches will cause `pnpm install` to fail.

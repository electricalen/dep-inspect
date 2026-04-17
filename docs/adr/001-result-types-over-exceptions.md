# ADR 001: Result Types Over Exceptions

## Status

Accepted

## Context

Error handling in Node.js/TypeScript applications typically follows one of two patterns:

1. **try/catch with thrown exceptions** — the default Node.js approach
2. **Result types** — explicit return-value-based error handling (Rust's `Result<T, E>`)

For a CLI tool that orchestrates multiple external API calls (npm registry, GitHub, OSV), each of which can fail independently, error handling strategy significantly impacts code clarity and reliability.

## Decision

Use **neverthrow** `Result<T, E>` and `ResultAsync<T, E>` types for all fallible operations. Reserve `throw` exclusively for programmer bugs (invariant violations that should never occur in correct code).

## Consequences

### Positive

- **Errors are visible in the type signature** — callers cannot accidentally ignore failures
- **Exhaustive error handling** — discriminated union `AppError` type forces handling of each error kind
- **Composable** — `Result.map`, `Result.andThen`, `ResultAsync.combine` enable clean data pipelines
- **Graceful degradation** — partial failures (e.g., GitHub rate-limited but registry succeeds) are naturally expressible via `orElse`

### Negative

- **Learning curve** — developers unfamiliar with Result types need to learn the API
- **Verbosity** — some operations require more code than a simple try/catch
- **Library dependency** — tied to neverthrow (though the API surface we use is small)

### Mitigations

- `src/shared/result.ts` re-exports only what we use, limiting coupling to neverthrow
- Discriminated union `AppError` keeps error types well-organized

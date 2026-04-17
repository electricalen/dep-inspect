# ADR 002: Ports and Adapters Architecture

## Status

Accepted

## Context

dep-inspect integrates with multiple external services (npm registry, GitHub API, OSV database) and local data sources (lockfiles, package.json). These have different failure modes, rate limits, and data shapes.

## Decision

Use **hexagonal architecture** (ports and adapters) with manual constructor injection:

- **Ports** (`src/ports/`) — TypeScript interfaces defining what capabilities the core needs
- **Adapters** (`src/adapters/`) — concrete implementations that satisfy port interfaces
- **Core** (`src/core/`) — pure domain logic with zero I/O imports

Dependency injection is manual — commands wire adapters to analyzers in `src/cli/commands/shared.ts` (the composition root). No DI container.

## Consequences

### Positive

- **Testability** — core logic is trivially testable with fake/stub adapters
- **Swappability** — can replace npm registry with a mirror, GitHub REST with GraphQL, etc.
- **Cache transparency** — cache decorators wrap adapters without modifying core logic
- **Separation of concerns** — I/O boundary is explicit and contained

### Negative

- **More files** — separate port + adapter files for each external dependency
- **Indirection** — must look up adapter to see actual implementation
- **Manual wiring** — composition root must be maintained as adapters change

### Mitigations

- Keep ports minimal (1-2 methods each)
- Composition root is a single file (`shared.ts`) that wires everything

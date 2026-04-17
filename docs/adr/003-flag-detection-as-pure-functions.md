# ADR 003: Flag Detection as Pure Functions

## Status

Accepted

## Context

The core value proposition of dep-inspect is detecting risk signals (flags) across dependency metadata. Detection logic must be reliable, testable, and composable.

## Decision

All flag detectors are **pure functions** with the signature:

```typescript
(preFetchedData, config?) => Flag[]
```

Detectors receive pre-fetched data and produce flag arrays. They perform zero I/O — no network calls, no filesystem access. Data fetching is the responsibility of the analysis orchestrators.

## Consequences

### Positive

- **Trivially testable** — no mocks needed, just pass data and assert on output
- **Composable** — orchestrators call detectors in any order, combine results with spread
- **Property-testable** — pure functions are ideal for property-based testing (e.g., "if license is in deny list, always produces a violation flag")
- **Deterministic** — same input always produces same output

### Negative

- **Data must be pre-fetched** — orchestrators are responsible for gathering all required data before calling detectors
- **Cannot lazily fetch** — a detector can't decide mid-execution that it needs additional data

### Mitigations

- Orchestrators handle all data fetching with concurrency limiting
- Optional data (e.g., GitHub enrichment) is passed as `| undefined` — detectors degrade gracefully

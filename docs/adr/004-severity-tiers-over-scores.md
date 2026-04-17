# ADR 004: Severity Tiers Over Scores

## Status

Accepted

## Context

Dependency risk tools typically use one of two approaches:

1. **Numeric scores** (e.g., 0-100 risk score) — opaque, hard to act on
2. **Discrete severity tiers** (critical/warning/info) — actionable, maps to CI gates

## Decision

Use **three discrete severity tiers** instead of numeric scores:

- **Critical** — blocks CI, requires immediate action (vulnerabilities, deprecated, license violations)
- **Warning** — review recommended, may block CI depending on policy (install scripts, unmaintained, single maintainer)
- **Info** — context for decision-making, never blocks CI (dependency footprint, version risk)

Severity is configurable per-flag in `.dep-inspect.json`. Each flag has a default severity in `FLAG_METADATA`, but teams can override.

## Consequences

### Positive

- **Actionable** — developers know exactly what to do: fix critical, review warnings, note info
- **CI-friendly** — `failOn: "critical"` or `failOn: "warning"` maps directly to exit codes
- **Transparent** — output shows exactly why each flag was raised and at what severity
- **Configurable** — teams can promote/demote flags or disable them entirely (`"off"`)

### Negative

- **Less granular** — can't express "this is slightly more concerning than that warning"
- **Fixed categories** — adding a new tier later would require changes across formatters and policy

### Mitigations

- Three tiers map well to traffic-light mental model (red/yellow/green)
- Flags carry their own evidence data, so users can make nuanced judgments within a tier

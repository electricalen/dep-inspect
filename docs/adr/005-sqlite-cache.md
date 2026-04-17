# ADR 005: SQLite Cache with WAL Mode

## Status

Accepted

## Context

dep-inspect makes numerous HTTP requests per scan (npm registry, GitHub API, OSV). Repeated scans of the same project would be slow and wasteful without caching. The cache needs to:

- Persist across CLI invocations
- Support TTL-based expiry with configurable durations per data source
- Handle concurrent access (multiple terminals running scans)
- Support LRU eviction when cache grows too large
- Be zero-configuration (no external services)

## Decision

Use **better-sqlite3** with WAL (Write-Ahead Logging) mode:

- Single SQLite file at `~/.dep-inspect/cache/cache.sqlite3` (respects `XDG_CACHE_HOME`)
- Data stored as gzip-compressed JSON blobs (5-10x compression)
- TTL expiry per namespace (registry: 1h, github: 6h, vulnerability: 30m, downloads: 24h)
- LRU eviction: when total size exceeds limit, delete least-recently-accessed entries
- ETag support for conditional HTTP requests (future optimization)

Cache is integrated via the **decorator pattern**: `CachedRegistryAdapter` wraps `NpmRegistryAdapter` transparently. The inner adapter has no cache awareness.

## Consequences

### Positive

- **Zero configuration** — no Redis/Memcached, works out of the box
- **Concurrent-safe** — WAL mode handles multiple readers/writers
- **Persistent** — survives process restarts, speeds up repeated scans
- **Configurable** — TTLs and max size adjustable in `.dep-inspect.json`
- **Transparent** — adapter pattern means core logic is cache-unaware

### Negative

- **Native dependency** — `better-sqlite3` requires node-gyp build
- **Single-machine** — no shared cache across CI runners (acceptable for a CLI tool)
- **Storage overhead** — SQLite file on disk (mitigated by gzip compression)

### Mitigations

- `pnpm.onlyBuiltDependencies` explicitly allows the native build
- `cache clear` and `cache stats` commands for user control
- Compression keeps storage minimal (typically <10MB for a large project)

## Alternatives Considered

- **In-memory cache** — lost between invocations, defeats the purpose
- **File-based cache** (one JSON file per entry) — poor concurrency, messy directory
- **Redis** — overkill for a CLI tool, adds infrastructure dependency

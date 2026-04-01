---
name: data-structure-review
description: >-
  Review and recommend data structures optimized for scale — constant-time
  access, bounded memory, minimal allocations. Use when designing new types,
  reviewing schemas, choosing collections, or optimizing hot paths.
allowed-tools: Read, Grep, Glob
---

## Priority Order

Every data structure choice must justify itself against these priorities:

1. **O(1) access** — hash maps, arrays, bitfields. O(log n) only when ordering is required.
2. **Bounded memory** — fixed-capacity structures (ring buffers, LRU caches, arenas) over unbounded growth.
3. **Zero allocation at steady state** — pre-allocate, pool, reuse. No per-request heap allocs on hot paths.
4. **Cache locality** — flat arrays of values over pointer-heavy trees. Struct-of-arrays when iterating single fields.
5. **Lock granularity** — per-key or sharded locks over global mutexes. Redis distributed locks for cross-replica.

## Decision Table

| Need | Prefer | Avoid |
|---|---|---|
| Key-value lookup | `map[K]V`, `sync.Map`, LRU cache | Linear scan, nested loops |
| Membership test | `map[K]struct{}`, bloom filter, bitset | `[]T` + `contains()` |
| Bounded recent items | `expirable.LRU`, ring buffer, capped heap | Unbounded slice append |
| Concurrent counters | `atomic.Int64`, sharded counters | `sync.Mutex` + `int` |
| Time-series / expiry | `expirable.LRU`, TTL map, Redis with EXPIRE | Manual GC goroutines scanning full maps |
| Cross-replica locks | Redis `SET NX EX` + Lua unlock | In-process `sync.Map` of mutexes |
| Ordered iteration | B-tree, sorted slice (if rarely mutated) | Re-sorting on every read |
| Write-once config | Frozen struct, `sync.Once` | Global map with mutex on every read |

## Review Checklist

- [ ] **Growth is bounded** — every map/slice/channel has a fixed cap or eviction policy. Name the cap.
- [ ] **Hot-path allocs are zero** — verify with `go test -benchmem` or `go build -gcflags='-m'`.
- [ ] **No linear scans on collections >100 items** — needs an index or O(1) lookup.
- [ ] **Locks never held over I/O** — no DB queries, HTTP calls, or Stripe API under mutex.
- [ ] **Expiry is built-in** — TTL eviction via `expirable.LRU` or Redis EXPIRE, not manual cleanup goroutines.
- [ ] **Memory footprint is estimable** — state worst-case as function of known bounds.

## Codebase-Specific Patterns

This project uses `expirable.LRU` for in-process caches (preview tokens, slugs, ingest pod IPs) with DB fallback on miss. Redis handles cross-replica shared state (sessions, locks, rate limits). The stage map (`m.stages`) is in-memory with DB as source of truth — each replica rebuilds via `refreshPodStatuses()`.

## SQL/DB Side

- Index every column in WHERE/JOIN. Partial indexes for common filters (`WHERE ended_at IS NULL`).
- `EXISTS` over `COUNT(*)` for existence checks — short-circuits on first match.
- Keyset pagination, never OFFSET — OFFSET re-scans skipped rows.
- Fetch only needed columns, not `SELECT *`.

$ARGUMENTS

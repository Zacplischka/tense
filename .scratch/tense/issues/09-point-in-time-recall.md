# Point-in-time recall

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The retrieval module behind `recall(query, as_of?)`: hybrid semantic + keyword search fused with Reciprocal Rank Fusion, plus the temporal filter that returns Current Facts by default or whatever was Current at `as_of`. Every returned Fact carries its Source citation and validity interval.

## Acceptance criteria

- [ ] `recall(query)` returns Current Facts; `recall(query, as_of)` returns Facts that were Current at that date (`valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)`).
- [ ] Hybrid retrieval: pgvector cosine + Postgres full-text, fused with **RRF (constant `k` pinned)**; **filter-then-fuse order defined** and documented.
- [ ] **Each returned Fact includes its Source citation and validity interval** in the MCP response (story 5).
- [ ] Unit tests with fixed oracles: Current-only default, `as_of` correctness, and RRF ordering.

## Blocked by

- `07-wire-remember-pipeline`

## Comments

✅ **Completed 2026-06-06.** Verified live over MCP + real Postgres.

- `src/retrieval/recall.ts` — `recall(deps, query, { asOf, limit })`. Hybrid:
  pgvector cosine (`embedding <=> $q`) + Postgres full-text (`ts_rank` over
  subject/predicate/object), fused with **RRF (k=60 pinned**, `src/retrieval/
  rrf.ts`, pure + unit-tested).
- **filter-then-fuse**: both rankers apply the temporal filter in SQL, so
  superseded Facts never enter ranking; RRF fuses after. Documented in the module.
- **Temporal filter**: default = `expired_at IS NULL`; `as_of T` =
  `valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)` (ADR 0002).
  Empty query browses the filtered set.
- Each result carries Source citation + validity interval.
- Tests: RRF ordering (pure oracle); recall integration (current-only default,
  as_of before/after, citation+interval, empty-query browse).

**Live MCP check:** `recall "who does Zach report to"` → Bob (Current);
`recall … as_of=2024-03-01` → Alice (valid 2024-01-01→2024-06-01) — each with
Source + interval. 72 tests green.

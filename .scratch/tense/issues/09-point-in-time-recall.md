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

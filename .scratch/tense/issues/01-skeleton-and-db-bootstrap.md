# Walking skeleton + DB bootstrap

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The thinnest end-to-end path through the system: an MCP server over **stdio** that exposes `remember` and `recall`, backed by a single Postgres, with a **stubbed extractor** so the full pipeline exists before any LLM. This slice owns the database foundation the whole project stands on.

The stub extractor must emit **supersession-shaped** data — at least two Facts on a single-valued Predicate for the same subject — so the round-trip actually exercises the bi-temporal columns, the Current partial index, and the Source provenance link rather than a trivial single Fact.

## Acceptance criteria

- [ ] One-command DB bootstrap/migration that enables `vector` and `pg_trgm` extensions and creates the schema: `entities`, `facts` (bi-temporal columns `valid_at`/`invalid_at`/`created_at`/`expired_at`), `sources`, with a Fact→Source provenance FK.
- [ ] A partial index on Current Facts (`WHERE expired_at IS NULL`).
- [ ] The temporal graph store exposes an **atomic supersession transaction boundary** (expire-old + insert-new in one transaction) for later slices to use.
- [ ] MCP stdio server exposes `remember(text, source)` and `recall(query)`; a client can connect, `remember`, then `recall` and get the Fact back with its Source.
- [ ] Stub extractor deterministically emits ≥2 Facts on a single-valued Predicate (supersession-shaped), no LLM calls.
- [ ] Integration test suite (real Postgres): bi-temporal round-trips, the Current partial index, and Fact→Source provenance links.

## Blocked by

None - can start immediately.

## Comments

✅ **Completed 2026-06-06.** All acceptance criteria met and verified against
real services.

- **Stack:** TypeScript (ESM, NodeNext), pnpm, `pg`, `@modelcontextprotocol/sdk`
  1.29, `zod` 4, `vitest`. Plain-SQL migrations applied by `src/db/migrate.ts`.
- **One-command bootstrap:** `pnpm db:setup` (Docker `pgvector/pgvector:pg16` +
  migrate). `psql` confirmed `vector` + `pg_trgm`, the bi-temporal columns, the
  partial index `WHERE (expired_at IS NULL)`, and the Fact→Source FK.
- **Atomic supersession boundary:** `TemporalGraphStore.supersedeAndInsert`
  (expire-old + insert-new in one txn). Rollback-on-failure covered by a test.
- **Real stdio MCP round-trip** (Inspector CLI): `tools/list` → `remember`/
  `recall`; two `remember`s drove a supersession; `recall` returned only the
  Current Fact with its Source + validity interval. `psql` confirmed both rows
  retained (expire-not-delete), one Current.
- **Tests:** 16 passing (stub-extractor unit + store/pipeline integration).

**Design note for slice 03 (the crown jewel):** the store keeps the valid-time
close (`invalid_at = new.valid_at`) and the transaction-time close
(`expired_at = now()`) as **separate** explicit parameters — it holds the
*mechanism*, no policy. This contradicts `BUILD-ORDER.md` line 53 ("old Fact
`expired_at = new.valid_at`"), which conflates the two times and would break the
ADR-0002 point-in-time formula. Reconcile BUILD-ORDER before/while building 03.

**Temporary, to be replaced by slice 03/07:** the single-valued predicate set in
`src/pipeline.ts` (`SINGLE_VALUED_PREDICATES`) is a stand-in for the predicate
registry + deterministic resolver.

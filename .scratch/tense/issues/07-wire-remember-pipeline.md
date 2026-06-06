# Wire Extraction + Resolution + Supersession into `remember`

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The convergence slice: replace slice 01's stub with the real ingest pipeline. `remember(text, source)` now runs Extraction → entity resolution → supersession (cardinality) end to end and persists via the atomic transaction. This is where the three independently-built modules become one path.

## Acceptance criteria

- [ ] `remember` runs the full pipeline: extract Facts, resolve their Entities, apply supersession, persist atomically.
- [ ] Ingesting two conflicting Sources on a single-valued Predicate for the same (resolved) subject closes the prior Fact and opens the new Current one — the org-change behavior, end to end.
- [ ] `remember` returns a summary of Entities/Facts created and any Facts superseded.
- [ ] Extraction failures (bad LLM output) surface as a `remember` error without corrupting the graph or crashing the server.
- [ ] End-to-end MCP-adapter integration test (provider stubbed/replayed) asserting the above.

## Blocked by

- `03-supersession-resolver-cardinality`
- `05-extraction`
- `06-entity-resolution`

## Comments

✅ **Completed 2026-06-06.** The convergence slice — verified against real
OpenRouter + real Postgres over real stdio MCP.

- `src/pipeline.ts` rewritten: `remember(deps, text, source)` runs extract →
  resolveOrCreate Entities (slice 06) → `resolveSupersession` (slice 03) →
  `applySupersessionPlan` (atomic) → best-effort embedding (slice 02). The
  temporary slice-01 single-valued set is gone. `RememberDeps` injects store /
  extractor / resolver / registry / provider / clock.
- **No-corruption ordering:** extraction runs before any write, so a bad-output
  failure leaves the graph untouched (no orphan Source) — tested.
- **MCP adapter** returns `isError` results instead of throwing → a bad
  extraction never crashes the server (in-memory client↔server test +
  extraction-failure test).
- Summary reports Facts created and superseded (closed Fact's real object
  resolved, not the incoming one).

**Real e2e** (Inspector CLI): `remember "Zach reports to Alice. Zach knows Carol."`
then `remember "Zach now reports to Bob."` → psql shows Alice closed
(`invalid_at` via null-`valid_at` transaction-time fallback), Bob + Carol
Current, exactly one Zach Entity (no fork), all Facts embedded. 62 tests green.

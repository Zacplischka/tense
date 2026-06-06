# Supersession resolver (cardinality) — the crown jewel

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`  ·  Respects `docs/adr/0002-bitemporal-facts-cardinality-supersession.md`

## What to build

The pure, deterministic supersession resolver and the predicate registry it consults. This is the differentiator and is **decoupled from extraction on purpose** — it takes Facts as input, so it is built and tested against hand-seeded Facts, and persists via slice 01's atomic supersession transaction. After this slice, supersession-shaped data can be driven into Postgres directly (which unblocks the viewer).

Resolver shape (from the PRD): `(newFact, candidateFacts, predicateRegistry) → { toClose, direction, timestamps }`. Cardinality path only here; the LLM contradiction path comes later and must reuse this same direction rule.

## Acceptance criteria

- [ ] Predicate registry maps Predicate → single/multi-valued, with **seeded entries for the demo Predicates** (`reports-to`, `lives-in` single-valued; `knows`, `contributed-to` multi-valued); unknown Predicates default to multi-valued (fail-safe).
- [ ] A new Current Fact on a single-valued Predicate closes the prior Current Fact for that subject; multi-valued Predicates never supersede.
- [ ] Direction rule: the Fact with the earlier `valid_at` is closed; a newly-ingested Fact with an *older* `valid_at` is born already-expired — assert with concrete expected intervals.
- [ ] **Explicit degenerate-`valid_at` behavior:** null `valid_at` falls back to transaction-time ordering (documented degradation, no silent valid/transaction conflation); a `valid_at` tie breaks on transaction time.
- [ ] Superseded Facts are expired, never deleted; the close + insert happen in one DB transaction (no torn state).
- [ ] Exhaustive unit suite covering: cardinality fires/doesn't, direction, out-of-order/born-expired, null `valid_at`, tied `valid_at`, and that an unknown Predicate never wrongly closes history.

## Blocked by

- `01-skeleton-and-db-bootstrap`

## Comments

✅ **Completed 2026-06-06** (TDD, red→green per behavior). All acceptance
criteria met; pure logic + real-Postgres integration verified.

- **Pure resolver** `src/supersession/resolver.ts` — `resolveSupersession({
  newFact, candidateFacts, registry, now }) → { direction, toClose, newFact }`.
  No DB, no clock (transaction time injected as `now`), fully deterministic.
  `direction ∈ {no-supersession, new-supersedes-existing, existing-supersedes-new}`.
- **Predicate registry** `src/supersession/registry.ts` — seeded (`reports-to`,
  `lives-in` single; `knows`, `contributed-to` multi); unknown → multi (fail-safe).
- **Direction rule:** earlier `valid_at` closes; an out-of-order Fact (older
  `valid_at` than an existing one) is born already-expired (`expired_at` set,
  `invalid_at` = the next truth's `valid_at`), nothing closed.
- **Degenerate `valid_at` (explicit):** null → transaction-time fallback (close
  uses `invalid_at = now`, never silently reused as valid time); tie → the
  incoming Fact wins on transaction time.
- **Bridge** `src/supersession/apply.ts` — `applySupersessionPlan` maps a plan
  onto slice 01's atomic `store.supersedeAndInsert` (the only resolver↔DB seam).
- **Tests:** 8 resolver units + 3 registry units + 4 real-Postgres integration
  (newer/out-of-order/null/multi). Full suite 31 green. psql confirmed the
  corrected close: Alice `invalid_at = 2024-06-01` (= Bob `valid_at`) **and**
  `expired_at` = the supersession wall-clock — two times kept distinct.

**Note:** `BUILD-ORDER.md` line 53 was reconciled (was `expired_at = new.valid_at`,
which conflated the two times). The temporary `SINGLE_VALUED_PREDICATES` set in
`src/pipeline.ts` is now superseded by this resolver but stays until slice 07
rewires `remember` to it (per the build order).

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

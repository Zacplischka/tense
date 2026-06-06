# Reaffirmation: Facts cite multiple Sources

Status: ready-for-agent
Type: AFK

## Parent

Design record: `docs/adr/0005-reaffirmation-facts-cite-multiple-sources.md`, `CONTEXT.md`.

## What to build

Stop the always-on stream from duplicating knowledge. When a Source re-states a Fact that is already Current (same subject → Predicate → object), treat it as a **Reaffirmation**, not a new Fact: keep the single existing Fact and record the new Source as additional provenance.

Add a `fact_sources` join table (fact + source, with its own timestamp, unique per pair), backfilled from existing rows so current Facts keep their origin Source. Retain the existing single origin `source_id` on the Fact so existing reads, recall, and tests are unaffected. In the ingest pipeline, before inserting, check the Current Facts already fetched for `(subject, predicate)`: if one has the same object, append a `fact_sources` row and skip the insert — no new Fact, no Supersession, no enter-highlight. "Reinforced N times" becomes derivable as the count of Sources for a Fact.

## Acceptance criteria

- [ ] Migration creates the Fact↔Source many-to-many table and backfills one row per existing Fact from its current origin Source.
- [ ] Ingesting a Fact identical to an existing Current Fact creates **no** new Fact and adds exactly one provenance row; the Fact's id and Current status are unchanged.
- [ ] A genuinely new Fact, and a value change on a single-valued Predicate (Supersession), behave exactly as before — Reaffirmation only short-circuits exact re-statements of Current Facts.
- [ ] The dup-check reuses the current-Facts lookup the pipeline already performs (carry `object_id`; no extra per-candidate round-trip).
- [ ] Integration test (real Postgres): ingest the same Fact twice → one Fact, two provenance rows; ingest a contradicting value → Supersession, not Reaffirmation.
- [ ] Existing recall/history/viewer reads are unaffected (origin Source still present on the Fact).

## Blocked by

None - can start immediately.

## Comments

✅ **Completed.** `migrations/0003_fact_sources.sql` adds the Fact↔Source join
(both FKs `ON DELETE CASCADE`) and backfills one origin row per existing Fact.
Store gained `addFactSource` (idempotent `ON CONFLICT DO NOTHING`) and
`countFactSources`. The pipeline now does a pre-supersession dup-check on the
`(subject, predicate)` Current Facts it already fetches: an exact
`(subject, predicate, object)` match is a **Reaffirmation** — append provenance,
no new Fact, no Supersession, no highlight — otherwise it proceeds as before and
records the origin Source. `RememberSummary` gained `factsReaffirmed`. New
`test/reaffirmation.integration.test.ts` (re-state → 1 Fact / 2 Sources; same
single-valued value → no churn; different value → still supersedes) plus the
existing pipeline suite all green. **Live smoke confirmed reaffirmation via the
real LLM extractor** (identical POST returned `factsReaffirmed` with the same
Fact id, graph held one edge).

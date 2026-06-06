# Entity resolution

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The entity-resolution module so the same real-world Entity referenced under name variants resolves to one node instead of forking the graph. Cascade: exact normalized-name match → `pg_trgm` trigram fuzzy match → short-name/low-entropy guard forcing exact match for very short names. No LLM tiebreak in v1 (deferred).

## Acceptance criteria

- [ ] `resolve(candidate, existing) → entityId | new`.
- [ ] Exact normalized-name match resolves; trigram fuzzy resolves variants/typos ("Zach"/"Zachary").
- [ ] Short-name guard prevents false merges (e.g. "Zach" ≠ "Zara"); distinct real-world entities stay separate.
- [ ] **Stability test for the exact demo name-pair** used in the recorded demo (so the demo subject never forks).
- [ ] Unit suite covering exact, fuzzy, guard, and no-false-merge cases.

## Blocked by

- `05-extraction`

> Note: built before 05 — entity resolution depends only on the store + pg_trgm,
> not on extraction. 05 (extraction) and 07 (wiring) consume it next.

## Comments

✅ **Completed 2026-06-06.** Verified against real Postgres + pg_trgm.

- `src/resolution/entity-resolver.ts` — `EntityResolver.resolve(name) →
  { entityId | null, reason }`. Cascade: exact normalized-name →
  `similarity()` trigram fuzzy (threshold 0.4) → short-name guard.
- **Short-name guard:** a fuzzy match is rejected when BOTH names are short
  (≤4 chars), so Zach/Zara stay separate while Zach/Zachary (lengths 4/7) merge.
- Demo name-pair stability test: the subject resolves to one Entity across
  `Zach` / `zach` / `Zachary`, and `Zara` never collapses into it.
- 7 integration tests (exact, fuzzy variant, typo, guard, no-false-merge,
  empty, stability). No LLM tiebreak (deferred, per PRD).

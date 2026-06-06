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

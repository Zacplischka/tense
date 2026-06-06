# Smoke gold set (3–5 scenarios)

Status: ready-for-human
Type: HITL

## Parent

`.scratch/tense/PRD.md`

## What to build

A small, human-curated set of 3–5 Source→expected-graph scenarios used to verify that real Extraction (slice 05) produces sane Entities/Facts *before* the full ~30-scenario gold set exists. This breaks the ordering trap where extraction would otherwise ship unverified. Authoring requires human judgment, hence HITL.

## Acceptance criteria

- [ ] 3–5 scenarios, each: a Source text + the expected Entities and Facts (subject, Predicate, object, and `valid_at` where the text implies one).
- [ ] At least one scenario includes a single-valued Predicate that should supersede across two Sources (the org-change shape).
- [ ] At least one scenario has prose with **no extractable date** (null `valid_at`) so extraction's null handling is exercised.
- [ ] Stored in a fixture format the extraction tests can load.

## Blocked by

None - can start immediately (parallel with build).

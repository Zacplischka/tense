# Full gold eval set (~30 scenarios + temporal-QA bank)

Status: ready-for-human
Type: HITL

## Parent

`.scratch/tense/PRD.md`

## What to build

The human-curated gold set that is the oracle for *every* quantitative claim in the project (extraction quality, supersession precision/recall, the headline temporal-QA chart, DSPy lift). ~30 Source→expected-graph scenarios plus a temporal-QA question bank. Authoring requires human judgment, hence HITL; start early since downstream eval/optimization blocks on it.

## Acceptance criteria

- [ ] ~30 scenarios, each: Source(s) + expected Entities/Facts with validity intervals.
- [ ] Temporal-QA bank: each item has a question, an `as_of` where applicable, a **single unambiguous gold answer**, and the Source(s) that establish it.
- [ ] **Coverage of the hard cases:** null `valid_at`, tied `valid_at`, out-of-order ingestion, and **"still-true" facts that must NOT be superseded** (so false-supersession rate is measurable).
- [ ] Includes point-in-time questions whose answer changed over time (the cases where a recency-sorted baseline cannot win).

## Blocked by

None - can start immediately (parallel with build).

## Comments

⚙️ **AFK-authored 2026-06-06 (HITL review/expansion pending).** Agent authored the
set from the canonical demo; **a human should review and expand toward ~30.**

- `eval/gold.ts` — 10 scenarios + an 11-item temporal-QA bank. Scenarios use a
  `[YYYY-MM-DD]` grammar so they're deterministically stub-extractable AND natural
  for the LLM.
- Coverage (asserted by `test/gold.test.ts`): null `valid_at`, tied `valid_at`,
  out-of-order ingestion, still-true (multi-valued + distinct-subject) for
  false-supersession, cross-predicate (works-at/left, llm-only), and 5
  point-in-time questions whose answer changed over time.
- Each QA item has a single gold answer + names its establishing scenario.

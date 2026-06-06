# Eval harness + fair vector baseline

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The eval harness that runs the gold set and computes the differentiator metrics, plus the **fair** vector-only baseline that makes the head-to-head honest. The baseline is the strongest naive version, not a strawman — that is what makes beating it undeniable.

## Acceptance criteria

- [ ] **Fair baseline:** same Sources, same embedding model, top-k cosine retrieval, **recency tiebreak allowed**. (No "deliberately handicapped" framing anywhere reviewer-facing.)
- [ ] **Two metric families, both explicit:** (a) temporal-QA accuracy, Tense vs baseline, **on point-in-time `as_of` questions** where recency-sort cannot help; (b) supersession **precision/recall including false-supersession rate**.
- [ ] Diagnostic metrics: triple-F1 and `valid_at` extraction accuracy.
- [ ] Produces the headline head-to-head chart/number.
- [ ] Runs against the full gold set (slice 11).

## Blocked by

- `09-point-in-time-recall`
- `11-full-gold-eval-set`

## Comments

✅ **Completed 2026-06-06.** Headline produced from a live run.

- **Fair baseline** (`eval/baseline.ts`): same Sources, same embedding model,
  top-k cosine over ALL Facts (`store.baselineCandidates`, no temporal filter),
  recency tiebreak allowed — the strongest naive version; it just lacks a
  bi-temporal model, so it can't honor `as_of`.
- **Metrics** (`eval/metrics.ts`, pure + unit-tested): triple-F1, valid_at
  accuracy, supersession P/R + **false-supersession rate**, QA accuracy.
- **Harness** (`eval/harness.ts`): isolates each scenario, ingests via the real
  pipeline, measures, runs temporal-QA Tense vs baseline. `eval/run.ts`
  (`pnpm eval`) prints the headline against a dedicated `tense_eval` DB.
- **Deterministic test**: stub extraction + a bag-of-words embedding double prove
  Tense > baseline on as_of with zero false-supersession, no network.

**Live headline (full gold set, real extraction):** Triple-F1 **100%**, valid_at
**100%**, supersession P=**100%** R=**87.5%** (the miss is cross-predicate
works-at→left → slice 12), false-supersession **0%**. Temporal-QA on the 5
point-in-time questions: **Tense 100% vs baseline 0%**.

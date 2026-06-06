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

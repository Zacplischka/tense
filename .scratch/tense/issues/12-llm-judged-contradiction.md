# LLM-judged contradiction (off the demo path)

Status: ready-for-agent
Type: AFK (metric-gated)

## Parent

`.scratch/tense/PRD.md`  ·  Respects `docs/adr/0002-bitemporal-facts-cardinality-supersession.md`

## What to build

The general contradiction path that cardinality can't express (cross-Predicate "works-at" vs "left", state flips, detail updates): retrieve candidate Facts by semantic similarity → one LLM call nominates which are contradicted → the temporal gate sets direction. Kept off the critical demo path. Because the LLM step is nondeterministic, acceptance is **metric-based against the gold set**, not exact assertions.

## Acceptance criteria

- [ ] Candidate retrieval (hybrid, reusing the recall path) → LLM nomination of contradicted Facts → supersession.
- [ ] **Reuses slice 03's direction rule** (does not re-implement direction — one tested rule, not two).
- [ ] Metric-gated acceptance: precision/recall and false-supersession rate on the gold set meet a stated threshold.
- [ ] Demonstrates a cross-Predicate case ("Zach works at Acme" → "Zach left Acme" retires the works-at Fact).

## Blocked by

- `09-point-in-time-recall`
- `11-full-gold-eval-set`

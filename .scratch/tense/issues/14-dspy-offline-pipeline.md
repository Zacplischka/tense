# DSPy offline prompt-optimization pipeline

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`  ·  Respects `docs/adr/0003-dspy-offline-prompt-optimizer.md`

## What to build

A **dev-only, offline** Python pipeline that optimizes the extraction prompts against the eval metric and exports the result (optimized instructions + bootstrapped few-shot demonstrations) as **static TS assets** the server loads at runtime. No Python ships. Fenced off from the shipped TypeScript.

## Acceptance criteria

- [ ] DSPy optimizes against the gold metric (from slice 13) and exports static prompt assets consumed by the Extraction module.
- [ ] Produces a **lift report** (baseline F1 → optimized F1); ships whichever prompt set wins.
- [ ] **A no-improvement outcome is an acceptable "done"** — if DSPy doesn't beat the hand-tuned baseline, the baseline ships and the report records that.
- [ ] Python toolchain is isolated from the shipped TS (separate dir/setup); env setup documented (known time-sink).

## Blocked by

- `13-eval-harness-fair-baseline`

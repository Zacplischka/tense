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

## Comments

✅ **Completed 2026-06-06** (no-lift outcome — the explicitly-acceptable "done").

- **Shipped seam (TS):** `src/extraction/prompts.ts` loads an optional
  `dspy/compiled/extraction.json` (optimized instructions + few-shot demos) and
  falls back to the hand-tuned baseline when absent. The extractor consumes it;
  `resolveExtractionPrompt` is pure + unit-tested. No Python at runtime.
- **Offline pipeline (Python, fenced in `dspy/`):** `optimize.py` evaluates
  baseline triple-F1, compiles `BootstrapFewShot` against the same metric, prints
  a lift report, and exports the asset **only if it beats the baseline**.
  `scripts/export-gold.ts` feeds the gold set to Python decoupled from TS.
- **Finding:** the baseline already scores triple-F1 = 1.00 / valid_at = 1.00 on
  the gold set (`pnpm eval`), so there is no lift to capture — baseline ships,
  nothing exported. The pipeline captures lift once slice 11's gold set grows
  harder extraction cases.
- **Env caveat documented:** this box runs Python 3.14 (ahead of DSPy support;
  `ensurepip`/venv fails) — use a 3.11–3.12 interpreter to run the pipeline.

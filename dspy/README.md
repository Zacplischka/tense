# DSPy offline prompt optimizer (dev-only)

This directory is **fenced off from the shipped TypeScript** (ADR 0003). DSPy is
Python-only and runs **offline at development time** to optimize the extraction
prompt; the TS server never imports Python. It only loads the compiled output:
`dspy/compiled/extraction.json` (optimized instructions + bootstrapped few-shot
demonstrations). If that file is absent, the server uses the hand-tuned baseline
prompt in `src/extraction/prompts.ts` — so this whole step is **additive**.

## Workflow

```bash
cd dspy
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt              # known time-sink; needs a Py version DSPy supports
export OPENROUTER_API_KEY=sk-or-...           # same key as the TS app
export TENSE_EXTRACTION_MODEL=openai/gpt-4o-mini
pnpm tsx ../scripts/export-gold.ts            # writes dspy/gold.json from the gold set
python optimize.py
```

`optimize.py`:
1. evaluates the baseline extractor's triple-F1 on the gold set,
2. compiles a `BootstrapFewShot` program against the same metric,
3. prints a **lift report** (baseline F1 → optimized F1),
4. exports `compiled/extraction.json` **only if it beats the baseline**; otherwise
   it reports no lift and the baseline ships.

## Status / finding

The hand-tuned baseline already scores **triple-F1 = 1.00 and valid_at accuracy =
1.00** on the current gold set (see `pnpm eval`). With the metric already maxed,
there is **no lift for DSPy to capture on this set**, so the baseline ships and no
compiled asset is committed — exactly the "no-improvement is an acceptable done"
outcome ADR 0003 anticipates. The pipeline is in place to capture lift once the
gold set is expanded with harder extraction cases (the HITL slice-11 work).

> Note: this repo's dev box runs Python 3.14, which is ahead of DSPy's supported
> versions; create the venv with a 3.11–3.12 interpreter if `pip install` fails.

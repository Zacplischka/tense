# Extraction (text → Entities + Facts)

Status: ready-for-agent
Type: AFK (with HITL quality sign-off)

## Parent

`.scratch/tense/PRD.md`  ·  Respects `docs/adr/0003-dspy-offline-prompt-optimizer.md`

## What to build

The Extraction module: turn a Source's prose into Entities and Facts via structured-output LLM calls, with Predicate typing. Prompts are seeded from Graphiti's `extract_edges`/`resolve_edge` prompts and shipped as static assets (DSPy optimization comes later). Replaces the stub from slice 01 for the extraction step. Build is AFK; the quality bar ("good enough to feed the demo and eval") is a human sign-off against the smoke set.

## Acceptance criteria

- [ ] `extract(sourceText, knownEntities) → { entities, facts }` using the provider client's structured output.
- [ ] Extracts `valid_at`/`invalid_at` where the Source implies them; leaves them null otherwise (feeds slice 03's degenerate-`valid_at` path).
- [ ] **Bad-output handling:** malformed/garbage/empty LLM output is schema-validated and fails gracefully — `remember` returns a clear error summary and the MCP server does not crash.
- [ ] Passes against the smoke gold set (slice 04): expected Entities/Facts produced; `valid_at` extraction measured.
- [ ] Human quality sign-off recorded on the smoke-set outputs.

## Blocked by

- `02-provider-client-embeddings-config`
- `04-smoke-gold-set`

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

## Comments

✅ **Completed 2026-06-06** (HITL quality sign-off pending). Verified live.

- Unified `Extractor` interface (`src/extraction/types.ts`); `StubExtractor`
  (slice 01) updated to implement it as a replayable test double.
- `LlmExtractor` (`src/extraction/llm-extractor.ts`) — structured-output
  completion → zod-validated `{ entities, facts }`; predicate slugs normalized;
  `valid_at`/`invalid_at` parsed (null when the Source states none → feeds the
  degenerate path).
- **Static prompt asset** `src/extraction/prompts.ts` (seeded from Graphiti's
  extract approach; DSPy optimization is slice 14).
- **Bad-output handling:** non-JSON / schema-invalid output → `ExtractionError`
  (unit-tested). Slice 07 turns this into a clean `remember` error without
  crashing the server.
- **Live smoke** over `eval/smoke-gold.ts`: entityRecall=1.00, factRecall=1.00,
  predicateAccuracy=1.00, validAtAccuracy=1.00 (`openai/gpt-4o-mini`).

# Provider client + embeddings + config

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

A thin **OpenRouter** client (OpenAI-compatible) that serves both chat completions and embeddings, with user-configurable models, plus the config layer that selects them. Split out from Extraction so the vector path (recall) and resolution embeddings are unblocked independently of extraction quality. Injectable so other modules test without network.

## Acceptance criteria

- [ ] Provider client wraps OpenRouter for `complete()` and `embed()`, OpenAI-compatible.
- [ ] Model selection via env: `TENSE_EXTRACTION_MODEL` and `TENSE_EMBEDDING_MODEL`; config is validated at startup with a clear error on misconfiguration.
- [ ] Embeddings are generated and stored in pgvector for Facts.
- [ ] A test proves the configured model id is honored (swap model via one env var → request targets that model) — covers the "Gemma 3 4B is one config line away" promise.
- [ ] Client is injectable/stubbable for downstream unit tests.

## Blocked by

- `01-skeleton-and-db-bootstrap`

## Comments

✅ **Completed 2026-06-06.** Verified against live OpenRouter + real Postgres.

- `src/provider/openrouter.ts` — `OpenRouterClient` (OpenAI-compatible)
  `complete()` + `embed()`; injectable `fetchImpl`. `createProvider()` validates
  config and fails fast with a clear error when `OPENROUTER_API_KEY` (or a model
  id) is missing.
- Model selection via `TENSE_EXTRACTION_MODEL` / `TENSE_EMBEDDING_MODEL`, with a
  per-call `model` override — covers "Gemma 3 4B is one line away"
  (unit-tested: the request body's `model` matches the configured/overridden id).
- Migration `0002` adds `facts.embedding vector(1536)`; `store.setFactEmbedding`
  persists vectors. Live test confirms a real embedding stored with
  `vector_dims = 1536`.
- `.env` loaded natively (`src/env.ts`); tests load it via `test/setup.env.ts`
  but force the isolated test DB so the dev DB is never touched.

**Live smoke:** completion `openai/gpt-4o-mini` → "Pong"; embeddings
`text-embedding-3-small` → dim 1536. 42 tests green (live provider tests
`skipIf` no key).

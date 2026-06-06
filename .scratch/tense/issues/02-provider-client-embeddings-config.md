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

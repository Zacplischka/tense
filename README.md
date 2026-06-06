# Tense

**Temporal memory for AI agents — knows which version is true.**

An MCP server that stores agent knowledge as a hand-built **bi-temporal graph on
Postgres** and answers *which version is true now* — or *as of any past date* —
something a plain vector store cannot. See [`CONTEXT.md`](./CONTEXT.md) for the
domain glossary and [`docs/adr/`](./docs/adr/) for the architecture decisions
(notably *why there is no graph database and no Graphiti*).

## Status

Walking skeleton (slice 01): an MCP stdio server exposing `remember` / `recall`,
backed by one Postgres, with a deterministic stub extractor. Supersession-shaped
data flows through the real bi-temporal columns and the Current partial index.
Extraction with an LLM, point-in-time `recall(as_of)`, `history`, the live
viewer, and the eval harness follow — see [`.scratch/tense/`](./.scratch/tense/).

## Quickstart

Requires Docker and Node ≥ 20 (with [pnpm](https://pnpm.io)).

```bash
pnpm install
pnpm db:setup     # start Postgres (pgvector) + apply migrations
pnpm test         # logic + integration tests against real Postgres
pnpm build        # compile to dist/
```

### Talk to it over MCP (stdio)

```bash
# real client <-> server round-trip with the MCP Inspector CLI
npx @modelcontextprotocol/inspector --cli node dist/server.js --method tools/list

npx @modelcontextprotocol/inspector --cli node dist/server.js \
  --method tools/call --tool-name remember \
  --tool-arg 'text=[2024-01-01] Zach reports to Alice.'

npx @modelcontextprotocol/inspector --cli node dist/server.js \
  --method tools/call --tool-name recall --tool-arg 'query=Zach'
```

To wire it into an MCP client (Claude Code, Cursor), run `node dist/server.js`
as a stdio server with `TENSE_DATABASE_URL` set (see [`.env.example`](./.env.example)).

## How it works

- **Fact** — a directed, typed relationship `subject → predicate → object`, the
  only thing that can be superseded. Every Fact is **bi-temporal**: *valid time*
  (`valid_at`/`invalid_at`, when it was true in the world) and *transaction time*
  (`created_at`/`expired_at`, when the system held it as Current).
- **Current** = `expired_at IS NULL` — backed by a partial index, and the single
  definition every reader (recall, viewer) uses.
- **Supersession** closes the prior Fact (never deletes it) and opens the new
  one in one transaction, so no reader sees a torn state.

## Layout

```
migrations/        SQL migrations (one-command bootstrap)
src/db/            Postgres pool, migration runner, temporal graph store
src/extraction/    stub extractor (LLM extractor lands in slice 05)
src/mcp/           MCP server (remember / recall)
src/pipeline.ts    remember / recall orchestration
test/              logic unit tests + integration tests (real Postgres)
```

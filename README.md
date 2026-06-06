# Tense

**Temporal memory for AI agents — knows which version is true.**

Tense is an [MCP](https://modelcontextprotocol.io) server that gives an AI agent a
memory which tracks not just *what* it was told, but *when each thing was true*.
It stores knowledge as a hand-built **bi-temporal graph on Postgres** and answers
*which version is current* — or *what was true as of any past date* — something a
plain vector store cannot.

> A vector store indexes "Zach reports to Alice" and "Zach reports to Bob" with
> near-identical embeddings and happily returns both. It has no principled way to
> know the second **superseded** the first, when that happened, or who Zach
> reported to last quarter. Tense does.

## The result

On point-in-time questions whose answer changed over time — the one place a
recency-sorted vector store cannot win — measured against a **fair** vector
baseline (same Sources, same embeddings, recency tiebreak allowed):

| Metric (full gold set, live extraction) | Tense | Fair vector baseline |
|---|---|---|
| **Temporal-QA on point-in-time questions** | **100%** | **0%** |
| Temporal-QA, all questions | 100% | 55% |
| Supersession precision / recall | 100% / 100% | — |
| False-supersession rate | 0% | — |
| Extraction triple-F1 / valid_at accuracy | 100% / 100% | — |

Reproduce with `pnpm eval`. The baseline is the strongest naive version, not a
strawman — it just has no bi-temporal model, so for a past `as_of` it returns the
most-recent answer and is wrong.

![Live grey-out: a superseded edge dashes while the new one lights up](docs/media/greyout.gif)

## How it works

- **Fact** — a directed, typed relationship `subject → predicate → object`
  (_Zach → reports-to → Alice_), the only thing that can be superseded. Every Fact
  is **bi-temporal**: *valid time* (`valid_at`/`invalid_at` — when it was true in
  the world) and *transaction time* (`created_at`/`expired_at` — when the system
  held it as Current).
- **Current** = `expired_at IS NULL`, backed by a partial index — the single
  definition every reader (recall, viewer) uses.
- **Supersession** closes the prior Fact (never deletes it) and opens the new one
  in one transaction. Two trigger paths share one valid-time direction rule:
  deterministic **cardinality** (a single-valued Predicate gets a new value — the
  demo path) and **LLM-judged contradiction** (cross-Predicate "works-at" vs
  "left" — the general path).
- **Point-in-time recall** filters on valid time
  (`valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)`), so the agent can
  ask both "who does Zach report to *now*?" and "who did he report to *last
  quarter*?" — each answer cites the **Source** it came from.

See [`CONTEXT.md`](./CONTEXT.md) for the full domain glossary.

## Why Postgres — not a graph database, not Graphiti

The project's thesis is building a temporal knowledge platform *from first
principles*, so the bi-temporal supersession engine is built in-house:

- **No separate graph database.** At demo scale (hundreds–thousands of Facts),
  recursive CTEs cover any multi-hop traversal, so a graph DB earns nothing while
  adding a second store to operate — "overlapping stores" is the first thing a
  reviewer attacks. One Postgres holds the relational graph *and* the embeddings
  (`pgvector`) *and* fuzzy entity resolution (`pg_trgm`).
- **No Graphiti.** Graphiti is excellent, but delegating the differentiator to a
  library weakens the "I built it" story and forces a Python sidecar, conflicting
  with the TypeScript stack. Tense keeps Graphiti's best ideas (LLM-nominate →
  temporal-gate contradiction) and **adds** a deterministic cardinality path on
  top, so the filmed demo is reproducible: *deterministic where it must be,
  Graphiti-grade where it counts.*

Full reasoning: [ADR 0001](./docs/adr/0001-hand-built-temporal-graph-on-postgres.md),
[ADR 0002](./docs/adr/0002-bitemporal-facts-cardinality-supersession.md),
[ADR 0003](./docs/adr/0003-dspy-offline-prompt-optimizer.md).

## Quickstart

Requires Docker and Node ≥ 20 (with [pnpm](https://pnpm.io)).

```bash
pnpm install
pnpm db:setup          # start Postgres (pgvector + pg_trgm) and run migrations
cp .env.example .env   # add your OPENROUTER_API_KEY for extraction/recall
pnpm test              # logic + integration tests against real Postgres
pnpm build             # compile to dist/
pnpm check             # the full verify gate: typecheck · lint · build · test, plus the viewer (typecheck · build)
```

### Connect it to an MCP client (Claude Code / Cursor)

Tense speaks MCP over stdio. Point your client at the built server:

```jsonc
{
  "mcpServers": {
    "tense": {
      "command": "node",
      "args": ["/absolute/path/to/tense/dist/server.js"],
      "env": {
        "TENSE_DATABASE_URL": "postgres://postgres:tense@localhost:5432/tense",
        "OPENROUTER_API_KEY": "sk-or-...",
        "TENSE_EXTRACTION_MODEL": "openai/gpt-4o-mini",
        "TENSE_EMBEDDING_MODEL": "openai/text-embedding-3-small"
      }
    }
  }
}
```

Or drive it directly with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector --cli node dist/server.js --method tools/list

npx @modelcontextprotocol/inspector --cli node dist/server.js \
  --method tools/call --tool-name remember \
  --tool-arg 'text=On 2024-01-01, Zach started reporting to Alice.'

npx @modelcontextprotocol/inspector --cli node dist/server.js \
  --method tools/call --tool-name recall \
  --tool-arg 'query=who does Zach report to' --tool-arg 'as_of=2024-03-01'
```

### MCP tools

| Tool | Signature | Returns |
|---|---|---|
| `remember` | `(text, source?)` | Facts created / superseded / reaffirmed after extraction + supersession (each superseded Fact tagged `reason`: `cardinality` / `contradiction`), plus how each name resolved (`entitiesResolved`: new / exact / fuzzy) |
| `preview` | `(text)` | Dry-run of `remember` — what it *would* create / supersede / reaffirm (and how names resolve), writing nothing |
| `recall` | `(query, as_of?, predicate?, limit?, min_reinforced?)` | Ranked Facts — Current by default, or valid-at-`as_of`; optionally scoped to a Predicate, capped, or filtered to Facts confirmed by ≥`min_reinforced` Sources — each with Source, validity interval, `reinforcedBy`, and `learnedAt` (transaction time) |
| `history` | `(entity, predicate?)` | The full Supersession chain for a subject, chronological — each Fact with its valid interval, `learnedAt`, and `retiredAt` (when the system closed it) |
| `changes` | `(since, limit?)` | Transaction-time change feed — Facts learned or retired since a date (incremental sync), each with `learnedAt`/`retiredAt` |
| `stats` | `()` | A read-only snapshot: Entity/Source counts, Facts split Current vs superseded, and a per-Predicate breakdown — each with its `cardinality` (`single` supersedes / `multi` accumulates) |
| `entities` | `(query?, limit?)` | List/search Entities, each with its Current-Fact count (degree), most-connected first |
| `sources` | `(limit?)` | List ingested Sources newest-first — label, preview, ingest time, and how many Facts cite each |

### Worked example

The org-change story end to end. (`id`/`sourceId` are UUIDs, abbreviated here,
and `learnedAt` is a wall-clock ingest time — yours will differ; every other
value is exactly what the tools return.)

**1. `remember` the first Source** — `text: "[2024-01-01] Zach reports to Alice."`, `source: "org-2024q1"`:

```json
{ "sourceId": "0d67…", "factsReaffirmed": [],
  "factsCreated": [{ "id": "c08d…", "subject": "Zach", "predicate": "reports-to", "object": "Alice" }],
  "factsSuperseded": [],
  "entitiesResolved": [{ "input": "Zach", "resolvedTo": "Zach", "reason": "new" },
                       { "input": "Alice", "resolvedTo": "Alice", "reason": "new" }] }
```

`entitiesResolved` shows how each name was placed — `new`, `exact`, or `fuzzy`
(a variant merged into an existing Entity, with its similarity) — so a wrong
merge is visible rather than silent.

**2. `remember` the change** — `text: "[2024-06-01] Zach reports to Bob."`, `source: "org-2024q2"`.
`reports-to` is single-valued, so the Alice Fact is **superseded** (closed, not deleted):

```json
{ "sourceId": "7deb…", "factsReaffirmed": [],
  "factsCreated": [{ "id": "3d7b…", "subject": "Zach", "predicate": "reports-to", "object": "Bob" }],
  "factsSuperseded": [{ "id": "c08d…", "subject": "Zach", "predicate": "reports-to", "object": "Alice", "reason": "cardinality" }],
  "entitiesResolved": [{ "input": "Zach", "resolvedTo": "Zach", "reason": "exact" },
                       { "input": "Bob", "resolvedTo": "Bob", "reason": "new" }] }
```

Each superseded Fact carries a `reason` for **why** it closed — `cardinality`
(a single-valued Predicate got a new object, as here) or `contradiction` (an
LLM-judged cross-Predicate conflict, e.g. "works-at" retired by "left"), which
closes a Fact under a *different* predicate than the one just stated.

**3. `recall` now** — `query: "Zach reports to"` returns only the Current Fact, with its Source and open validity interval:

```json
[{ "id": "3d7b…", "subject": "Zach", "predicate": "reports-to", "object": "Bob",
   "validAt": "2024-06-01T00:00:00.000Z", "invalidAt": null, "current": true,
   "learnedAt": "2025-09-12T18:04:53.217Z",
   "source": { "id": "7deb…", "label": "org-2024q2", "text": "[2024-06-01] Zach reports to Bob." },
   "reinforcedBy": 1 }]
```

`reinforcedBy` is how many distinct Sources assert the Fact (origin + any
[Reaffirmations](#how-it-works)); a higher count means a more-confirmed Fact.
`learnedAt` is the **transaction time** — when the system learned the Fact — the
other bi-temporal axis from `validAt`/`invalidAt` (when it was *true*): Zach has
reported to Bob since 2024-06-01, but the system only learned it at ingest.
`current` says *whether* a Fact has been retired; `learnedAt` says *when* it
entered memory.

**4. `recall` point-in-time** — same `query` with `as_of: "2024-03-01"` returns who was Current *then* — Alice — closed off at the moment Bob took over:

```json
[{ "id": "c08d…", "subject": "Zach", "predicate": "reports-to", "object": "Alice",
   "validAt": "2024-01-01T00:00:00.000Z", "invalidAt": "2024-06-01T00:00:00.000Z", "current": false,
   "learnedAt": "2025-09-12T18:04:51.880Z",
   "source": { "id": "0d67…", "label": "org-2024q1", "text": "[2024-01-01] Zach reports to Alice." },
   "reinforcedBy": 1 }]
```

**5. `history`** — `entity: "Zach"`, `predicate: "reports-to"` returns the whole chain chronologically: the closed Alice Fact, then the Current Bob Fact — the recall row shape **plus** `retiredAt` (the transaction time each Fact was closed; `null` for the Current one), so the chain shows both *when each was true* and *when it was retired*.

**6. `stats`** — the graph at a glance:

```json
{ "entities": 3, "sources": 2,
  "facts": { "total": 2, "current": 1, "superseded": 1 },
  "predicates": [{ "predicate": "reports-to", "current": 1, "total": 2, "cardinality": "single" }] }
```

Each Predicate carries its `cardinality` — `single` (a new value supersedes the
prior, e.g. `reports-to`) or `multi` (values accumulate, e.g. `knows`) — the rule
that governs whether ingesting supersedes or adds, so an agent can predict it.

**7. `preview`** — a dry-run of step 2 *before* committing it. `text: "[2024-09-01] Zach reports to Dana."` reports what `remember` *would* do — create the Dana Fact and supersede Bob — **writing nothing**:

```json
{ "factsToCreate": [{ "subject": "Zach", "predicate": "reports-to", "object": "Dana" }],
  "factsToSupersede": [{ "subject": "Zach", "predicate": "reports-to", "object": "Bob" }],
  "factsToReaffirm": [],
  "entitiesResolved": [{ "input": "Zach", "resolvedTo": "Zach", "reason": "exact" },
                       { "input": "Dana", "resolvedTo": "Dana", "reason": "new" }] }
```

**8. `changes`** — the transaction-time feed (`since: "1970-01-01"` for "everything"), newest change first. Each Fact carries the recall fields **plus** `learnedAt` / `retiredAt` (wall-clock — when the *system* knew it); `validAt`/`invalidAt`/`reinforcedBy` are omitted below for brevity. An agent can sync incrementally:

```json
[{ "id": "845d…", "subject": "Zach", "predicate": "reports-to", "object": "Bob",
   "current": true,  "learnedAt": "2026-06-06T16:32:58.351Z", "retiredAt": null,
   "source": { "id": "3c2f…", "label": "org-2024q2", "text": "[2024-06-01] Zach reports to Bob." } },
 { "id": "ad57…", "subject": "Zach", "predicate": "reports-to", "object": "Alice",
   "current": false, "learnedAt": "2026-06-06T16:32:58.345Z", "retiredAt": "2026-06-06T16:32:58.351Z",
   "source": { "id": "5515…", "label": "org-2024q1", "text": "[2024-01-01] Zach reports to Alice." } }]
```

Note `learnedAt`/`retiredAt` (transaction time — when the system learned/retired the
Fact) are distinct from `validAt`/`invalidAt` (valid time — when it was true in the
world); that bi-temporal split is the whole point.

### The live viewer

```bash
cd viewer && pnpm install && pnpm dev   # http://localhost:3000
```

Renders the graph from Postgres and animates Supersession: Current Facts solid,
superseded Facts greyed/dashed, updating live as Facts change. New Entities and
Facts glow in on a stable layout (existing nodes never move), so you can watch the
graph *grow*.

The viewer is **read-mostly**: alongside the read path it exposes one local
ingestion endpoint, `POST /api/remember`, behind a drop-text box — paste text and
watch the graph react. The same endpoint is what the Claude Code session hook
posts to (ADR 0004). Ingestion needs `OPENROUTER_API_KEY` (and `TENSE_DATABASE_URL`)
in the viewer's environment; it reads the project-root `.env` by default.

## Models

OpenRouter is the sole gateway for completions and embeddings; both models are
user-configurable. The recorded demo runs on a frontier model; Gemma 3 4B is one
env line away (`TENSE_EXTRACTION_MODEL=google/gemma-3-4b-it`).

## Layout

```
migrations/        SQL migrations (one-command bootstrap)
src/db/            Postgres pool, migration runner, temporal graph store + atomic supersession
src/supersession/  pure resolver (cardinality + valid-time direction rule), predicate registry
src/resolution/    entity resolution (exact -> pg_trgm fuzzy -> short-name guard)
src/extraction/    LLM extractor + static prompt assets (stub double for tests)
src/contradiction/ LLM-judged contradiction (reuses the resolver's direction rule)
src/retrieval/     hybrid recall (RRF + temporal filter) and history
src/mcp/, server.ts  MCP stdio adapter and entry point
viewer/            read-mostly Next.js viewer (live grey-out + growth, drop-text ingestion)
eval/              gold set, metrics, fair baseline, harness (pnpm eval)
test/              logic unit tests + integration tests (real Postgres)
docs/adr/          architecture decisions  ·  CONTEXT.md  domain glossary
```

## Scope

Single-tenant, stdio transport, local Postgres. Out of scope (deliberately):
source-contradiction/trust-ranking (two Sources disagreeing at the *same* time),
hosting/multi-tenancy/auth, and a viewer timeline scrubber. See the
[PRD](./.scratch/tense/PRD.md).

## License

MIT.

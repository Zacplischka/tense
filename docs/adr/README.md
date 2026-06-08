# Architecture decision records

The decisions that shape Tense, with the reasoning and the options rejected.
Each record states a decision, the alternatives weighed, and the consequences —
so a reviewer can see *why* the system looks the way it does, not just that it does.

Read them in order for the build story, or jump to the one you're skeptical about.

| ADR | Decision | The crux |
|---|---|---|
| [0001](./0001-hand-built-temporal-graph-on-postgres.md) | Hand-built temporal graph on Postgres — no Graphiti, no graph DB | One store holds the relational graph, `pgvector` embeddings, and `pg_trgm` fuzzy match; the differentiating supersession engine is owned, not delegated. |
| [0002](./0002-bitemporal-facts-cardinality-supersession.md) | Bi-temporal Facts with two-path supersession | Valid time vs transaction time; supersession fires deterministically by **cardinality** (the demo path) or by **LLM-judged contradiction** (the general path), both resolved by one valid-time direction rule. |
| [0003](./0003-dspy-offline-prompt-optimizer.md) | DSPy as an offline prompt optimizer; ship static compiled prompts | DSPy tunes the extraction/contradiction prompts at dev time only; the TypeScript server loads the compiled output as static assets, keeping Python out of the shipped artifact. |
| [0004](./0004-viewer-hosts-ingestion-write-path.md) | Viewer hosts the ingestion write-path | `POST /api/remember` lives in the Next.js viewer rather than a second long-running service — the demo runs one process, and the manual textarea and the session hook hit the same seam. |
| [0005](./0005-reaffirmation-facts-cite-multiple-sources.md) | Reaffirmation: a Fact may cite multiple Sources | A re-stated Current Fact appends a `fact_sources` row instead of inserting a duplicate, so an always-on ingestion stream reinforces beliefs rather than bloating the graph. |
| [0006](./0006-introspection-and-preview-surface.md) | Read-only introspection and dry-run preview surface | `stats` / `entities` / `sources` let an agent audit its own memory, and `preview` shows what an ingest *would* do before committing — added around the write/query core without touching it. |
| [0007](./0007-ingest-assumes-a-single-writer.md) | Ingest assumes a single writer (concurrency model) | The read→decide→write path is not one atomic unit; correct under the current single-writer entry points, with the per-subject lock it would need under concurrent ingest documented up front. |
| [0008](./0008-hybrid-recall-filter-then-fuse.md) | Hybrid recall: filter-then-fuse, ranked by RRF | The temporal filter runs in SQL *before* two rankers (pgvector cosine + full-text) fuse via Reciprocal Rank Fusion — so superseded Facts never enter the ranking, and RRF needs no score normalization across the two incomparable scales. |

Format: each record is a short prose decision, a **Considered options** list (with
the rejected ones and why), and a **Consequences** section. There is no status
field — every ADR here reflects a decision that is live in the code.

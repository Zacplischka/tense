# PRD: Tense — Temporal memory for AI agents

Status: ready-for-agent

> Tense is a temporal-memory MCP server: it stores agent knowledge as a bi-temporal graph and answers "which version is true" — something a plain vector store cannot. See `CONTEXT.md` for the domain glossary and `docs/adr/0001`–`0003` for the architectural decisions this PRD respects.

## Problem Statement

An AI agent that remembers things using a vector store can recall *what* it was told, but not *which version is currently true*. When a fact changes — "Zach reports to Alice" becomes "Zach reports to Bob" — both statements sit in the index with similar embeddings, and a similarity search happily returns both. The agent has no principled way to know that the second superseded the first, when that happened, or what was true at some earlier date. The result is confidently stale or contradictory answers.

Separately, this project exists as a **portfolio proof-piece**: its author works on a temporal knowledge platform under NDA and needs a public artifact that *demonstrably* proves the competency — building a temporal knowledge platform from first principles, not just wiring up a library.

## Solution

Tense stores knowledge as **Entities** connected by **Facts** (typed, directed relationships). Every Fact is **bi-temporal** — it records both **valid time** (when it was true in the world) and **transaction time** (when the system held it as Current). When a new Fact arrives that conflicts with an existing one, Tense performs a **Supersession**: it closes the old Fact (never deletes it) and opens the new one, so the agent can ask both "who does Zach report to *now*?" and "who did he report to *last quarter*?" — each answer cites the **Source** it came from.

Agents interact through three MCP tools — `remember`, `recall(as_of?)`, and `history` — over stdio, so Tense plugs into Claude Code or Cursor. A live read-mostly Next.js viewer renders the graph, animates Supersession and growth in real time (Current Facts solid, superseded Facts greyed/dashed, new Facts glowing in), and exposes one local ingestion endpoint (`POST /api/remember`) behind a drop-text box — the same seam the Claude Code session hook posts to (ADR 0004). The flagship demonstration feeds two conflicting Sources and shows the graph re-wire live, then contrasts Tense's correct point-in-time answers against a vector-only baseline that cannot tell Current from stale.

## User Stories

**The AI agent (primary consumer, via MCP):**
1. As an agent, I want to `remember` a chunk of text, so that the facts within it become part of my durable memory without me structuring them by hand.
2. As an agent, I want Extraction to pull Entities and Facts from free text automatically, so that I can feed raw notes, messages, or documents.
3. As an agent, I want `recall(query)` to return only Current Facts by default, so that I answer with what is true now rather than everything ever stated.
4. As an agent, I want `recall(query, as_of)` to return what was Current at a past date, so that I can answer historical questions correctly.
5. As an agent, I want every recalled Fact to cite its Source, so that I can show provenance and justify my answer.
6. As an agent, I want `history(entity, predicate?)` to return the full Supersession chain for a subject, so that I can explain how a fact evolved over time.
7. As an agent, I want a new Fact on a single-valued Predicate to automatically supersede the prior one, so that "current manager" stays unambiguous.
8. As an agent, I want contradictory Facts on open-ended or cross-Predicate relations to be detected and resolved, so that "Zach left Acme" correctly retires "Zach works at Acme."
9. As an agent, I want superseded Facts retained rather than deleted, so that history is never lost.
10. As an agent, I want the same Entity referenced under slightly different names ("Zach" / "Zachary") to resolve to one node, so that my graph doesn't fragment.
11. As an agent, I want hybrid (semantic + keyword) recall, so that I find relevant Facts whether the query matches wording or meaning.

**The developer integrating Tense:**
12. As a developer, I want to connect Tense to Claude Code/Cursor over stdio with minimal config, so that I can give my agent memory quickly.
13. As a developer, I want to choose the extraction and embedding models via configuration, so that I can trade cost against quality.
14. As a developer, I want to run Tense against a frontier model or a small local-friendly model (Gemma 3 4B), so that I can demo on the best model and still let others run it cheaply.
15. As a developer, I want a single Postgres instance to back the whole system, so that setup is one dependency, not an exotic graph database.
16. As a developer, I want a seed script that loads the demo Sources, so that I can reproduce the demonstration locally.

**The portfolio reviewer / interviewer:**
17. As a reviewer, I want to watch the graph re-wire live as a contradicting Source is ingested, so that I immediately grasp what Supersession means.
18. As a reviewer, I want a side-by-side where a vector-only baseline returns both stale and current answers while Tense returns the correct Current one, so that the thesis is undeniable.
19. As a reviewer, I want to see point-in-time queries return historically-correct answers, so that I trust the bi-temporal model is real.
20. As a reviewer, I want metrics quantifying temporal-QA accuracy versus the vector baseline, so that the claim is backed by numbers, not vibes.
21. As a reviewer, I want to see supersession precision/recall (including false-supersession rate), so that I know the system doesn't "forget" still-true facts.
22. As a reviewer, I want the repo to read cleanly with a documented glossary and ADRs, so that I can follow the reasoning behind each decision.
23. As a reviewer, I want to understand why there is no graph database and no Graphiti, so that the architecture looks deliberate rather than naive.

**The maintainer / author:**
24. As the author, I want the Supersession logic isolated as a pure, deterministic module, so that I can test the hard part exhaustively.
25. As the author, I want extraction prompts tuned offline with DSPy and shipped as static assets, so that prompt quality is measured and reproducible without a Python runtime.
26. As the author, I want a gold eval set of curated scenarios, so that I can measure extraction and supersession quality and detect regressions.
27. As the author, I want a *fair* vector-only baseline in the eval harness (same Sources, same embeddings, recency-tiebreak allowed), so that beating it on point-in-time questions is undeniable rather than a dismissible strawman.
28. As the author, I want unknown Predicates to default to multi-valued, so that the system never wrongly closes history when it encounters a relation it hasn't classified.

## Implementation Decisions

**Architecture (per ADR 0001):** Hand-built temporal graph on a single Postgres instance — `pgvector` for embeddings, relational tables for Entities and Facts. No Graphiti, no separate graph database. Multi-hop traversal uses recursive CTEs at demo scale. TypeScript end-to-end.

**Bi-temporal model & supersession (per ADR 0002):** Facts carry `valid_at` / `invalid_at` (valid time, extracted from Source content) and `created_at` / `expired_at` (transaction time, wall-clock). A Fact is Current iff `expired_at IS NULL`; a partial index covers Current Facts. Point-in-time queries filter `valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)`. Supersession has two trigger paths sharing one valid-time direction rule (earlier `valid_at` closes; a newly-ingested older Fact is born already-expired): (1) **cardinality** — deterministic, single-valued Predicate gets a new value (the demo path); (2) **LLM-judged contradiction** — candidate retrieval → LLM nomination → temporal gate (off the critical demo path). Facts are expired, never deleted. **Degenerate `valid_at` policy (explicit):** when `valid_at` cannot be extracted (null — common for prose like "Zach now reports to Bob"), direction falls back to transaction-time ordering — a deliberate, *documented* degradation, never a silent conflation of valid and transaction time; a `valid_at` tie breaks on transaction time. Supersession (expire-old + insert-new) executes in a single DB transaction so no reader ever observes a torn state.

**Modules** (deep modules with simple, testable interfaces):
- **Supersession resolver** — pure function over `(newFact, candidateFacts, predicateRegistry)`; LLM contradiction-nomination injected as a dependency so the core is deterministic and isolation-testable.
- **Predicate registry** — maps Predicate → single/multi-valued; unknown defaults to multi-valued.
- **Entity resolution** — exact normalized-name match, then `pg_trgm` trigram fuzzy match, with a short-name/low-entropy guard forcing exact match for very short names. No LLM tiebreak in v1.
- **Extraction** — `(sourceText, knownEntities) → { entities, facts }`; wraps LLM structured-output calls and predicate typing; loads DSPy-compiled static prompts seeded from Graphiti's extract/resolve prompts.
- **Temporal graph store** — Postgres persistence for Entities/Facts including the bi-temporal columns and provenance link to Source.
- **Retrieval (recall)** — hybrid `pgvector` cosine + Postgres full-text, fused with Reciprocal Rank Fusion, plus the temporal filter (Current vs as-of-T).
- **History** — returns the ordered Supersession chain for a subject (+ optional Predicate).
- **LLM/embeddings provider client** — thin OpenRouter (OpenAI-compatible) wrapper; `TENSE_EXTRACTION_MODEL` and `TENSE_EMBEDDING_MODEL` config; injectable for tests.
- **MCP server adapter** — exposes `remember` / `recall(as_of?)` / `history` over stdio.
- **Viewer** — Next.js app reading Postgres directly; polls for updates; renders Current Facts solid, superseded Facts greyed/dashed.
- **Eval harness** (dev-only) — runs the gold set, computes the differentiator metrics, includes the vector-only baseline.
- **DSPy optimization pipeline** (dev-only, per ADR 0003) — Python, offline; emits static prompt assets; fenced off from the shipped TypeScript.

**Models:** OpenRouter is the sole gateway for both completions and embeddings; models are user-configurable. The recorded demo defaults to a frontier extraction model; Gemma 3 4B is one config line away. Embedding model is a separate id (e.g. `text-embedding-3-small`).

**MCP tool contracts:**
- `remember(text, source)` → ingests a Source, runs Extraction + entity resolution + Supersession; returns a summary of Entities/Facts created and any Facts superseded.
- `recall(query, as_of?)` → returns ranked Facts (Current by default, or Current-as-of `as_of`), each with its Source citation and validity interval.
- `history(entity, predicate?)` → returns the Supersession chain (past and present Facts) for the subject.

**Deployment:** stdio transport only, single-tenant, local Postgres; the public artifact is the repo plus a polished screen recording. No auth, no multi-tenancy.

## Testing Decisions

**What makes a good test:** assert external behavior, not implementation. Tests describe observable outcomes ("ingesting a contradicting Source closes the prior Fact and opens a new Current one with the correct validity interval"), never internal calls. Extraction and full end-to-end quality are measured by the **eval harness** (metric-based), not by brittle assertions.

**Scope: logic + integration.**
- **Unit (pure logic):**
  - *Supersession resolver* — the crown jewel: cardinality fires for single-valued Predicates and not for multi-valued; the valid-time direction rule picks the right Fact to close; out-of-order ingestion resolves correctly (newer-but-older Fact born expired); superseded Facts are retained; false-supersession is prevented for unknown (default multi-valued) Predicates.
  - *Entity resolution* — exact match; fuzzy match on name variants/typos; short-name guard prevents false merges ("Zach" ≠ "Zara"); distinct real-world entities stay separate.
  - *Retrieval temporal filter* — Current-only by default; `as_of` returns the historically-correct set; RRF fusion ordering.
  - *Predicate registry* — known cardinalities resolve; unknown defaults to multi-valued.
- **Integration (real Postgres):**
  - *Temporal graph store* — persistence round-trips of bi-temporal Facts; the Current partial index; provenance links to Source.
  - *MCP adapter* — `remember` / `recall(as_of?)` / `history` exercised end-to-end over the store with the LLM provider stubbed, asserting the demo's behavior.
  - *Extraction-via-fixtures* — gold Source inputs produce the expected Entities/Facts (provider stubbed/replayed).

**Prior art:** none yet — this is a greenfield repo; these tests establish the conventions.

## Out of Scope

- **Source-contradiction / trust-ranking** (two Sources disagreeing at the *same* time — who to believe). Distinct from temporal Contradiction; deferred.
- **Mutable attributes as Facts** (e.g. job title) — only entity-entity relationships are Facts in v1, unless a scenario forces otherwise.
- **Draggable, animated timeline slider** in the viewer — stretch goal. Point-in-time
  as-of *shipped* as a date picker (rewind to any past date); a dragged-through
  animation remains unbuilt.
- **streamable-HTTP transport, hosting, multi-tenancy, auth** — phase 2 (hosted read-only snapshot).
- **LLM tiebreak in entity resolution** — future work.
- **Communities, cross-encoder reranking, multi-backend drivers, MinHash/LSH** — overkill at demo scale.
- **UI-side ingestion** — the agent drives memory via MCP, not the browser.
- **DSPy as a runtime dependency** — it is offline/dev-only.

## Further Notes

- The canonical demo is a **3-beat org-change** story: (1) seed a Source and watch the graph grow; (2) feed a later, conflicting Source and watch the `reports-to` edge grey out while a new one lights up — *the* screenshot; (3) ask current-vs-as-of questions, contrasting Tense's correct answers against the vector-only baseline. Beat 2's grey-out animation must be flawless; spend viewer budget there.
- The **headline metric is temporal-QA accuracy: Tense vs. a *fair* vector-only baseline** on point-in-time (`as_of`) questions whose answer changed over time — the one place recency-sorting cannot help, so the bi-temporal model is the only thing that can be right. The baseline gets the same Sources, the same embeddings, and a recency tiebreak; the win is honest, not rigged. That single chart is the pitch.
- The cardinality path keeps the on-stage demo deterministic; the LLM-judged path proves the harder, general mechanism but stays off the critical demo path so flakiness there never breaks the demo.
- Name: **Tense**. Tagline: *Temporal memory for AI agents — knows which version is true.*

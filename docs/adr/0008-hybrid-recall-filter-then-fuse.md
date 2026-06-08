# Hybrid recall: filter-then-fuse, ranked by RRF

`recall(query, as_of?)` answers a query against the temporal graph by running **two
independent rankers** — pgvector cosine similarity over Fact embeddings and
Postgres full-text (`ts_rank` over `plainto_tsquery`) — and fusing their ranked id
lists with **Reciprocal Rank Fusion** (`k = 60`). Both rankers apply the temporal
filter **in SQL, before ranking**; RRF fuses the two lists; the top `limit` ids are
hydrated into full Facts. The ordering is the decision: **filter, then fuse.**

Implementation: [`src/retrieval/recall.ts`](../../src/retrieval/recall.ts) (orchestration),
[`src/retrieval/rrf.ts`](../../src/retrieval/rrf.ts) (fusion),
[`src/db/store.ts`](../../src/db/store.ts) (`rankBySemantic` / `rankByKeyword`, each
carrying the temporal `WHERE` clause).

## Filter-then-fuse, not fuse-then-filter

The temporal filter (`expired_at IS NULL` for Current, or the valid-time formula
`valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)` for an `as_of`) lives in
the `WHERE` clause of **each ranker's** query, so a superseded Fact never enters the
ranking in the first place. The alternative — rank the whole corpus, then drop
non-matching Facts afterward — is wrong here, not just slower:

- A superseded Fact (e.g. *Zach → reports-to → Alice*, embedded near the Current
  *→ Bob*) would consume a top-`k` ranking slot and could crowd the
  point-in-time-correct answer out of the candidate pool before the filter ran.
  Filtering first is *why* the eval's point-in-time row is 100% — the ranker only
  ever sees Facts that were valid at `T`.
- The filter is the most selective predicate (Current is backed by a partial index;
  `as_of` hits indexed `valid_at`/`invalid_at`), so pushing it into SQL ahead of the
  cosine/full-text scan keeps recall at low-single-digit milliseconds even with
  hundreds of superseded Facts to exclude (`pnpm bench`).

Correctness and latency point the same way: the temporal filter is a precondition on
the candidate set, not a post-filter on the results.

## Why fuse two rankers at all

A Fact is a structured triple (`subject → predicate → object`), and queries hit it
two different ways:

- **Lexical** — "Zach reports-to" matches the Fact's own tokens. Full-text nails
  exact names and predicates that embeddings blur together.
- **Semantic** — "who is Zach's manager?" never lexically matches `reports-to`; only
  the embedding bridges the paraphrase.

Either ranker alone loses one of these. The semantic ranker is also **best-effort**:
if the embedding provider is down, `recall` logs to stderr and falls back to
keyword-only rather than failing the query (see [ADR 0001](./0001-hand-built-temporal-graph-on-postgres.md)
on a down embedding path degrading recall, never breaking it). Two rankers make the
read path degrade gracefully instead of going dark.

## Considered options

- **Reciprocal Rank Fusion (chosen).** Combines lists by rank alone —
  `score += 1 / (k + rank)`, `k = 60` (the canonical value). It needs **no score
  normalization**, which is its decisive advantage: cosine *distance* and `ts_rank`
  *relevance* are on incomparable scales, and RRF never has to reconcile them. Pure,
  parameter-light, and deterministic (V8's stable sort makes ties fall back to
  first-appearance order), so it is unit-tested directly.
- **Weighted score blend (`α·cosine + (1−α)·ts_rank`).** Rejected: requires
  normalizing two incomparable score distributions and hand-tuning `α` — brittle,
  corpus-dependent, and a moving target as the graph grows. RRF gets the same
  "agree-near-the-top wins" behavior with no calibration.
- **Pure vector similarity.** Rejected: misses exact-name/predicate lexical matches
  and would hard-fail when the embedding provider is unavailable.
- **Pure full-text.** Rejected: misses paraphrase ("manager" ⇏ "reports-to"), the
  case a memory layer most needs to catch.
- **Cross-encoder / LLM re-ranker over the fused list.** Rejected at this scale: it
  adds a model round-trip to a path that must stay inside an agent's tool-call budget
  (the bench targets single-digit milliseconds). Worth revisiting only if recall
  quality, not latency, becomes the bottleneck.

## Consequences

- Each ranker pulls a candidate pool of `max(limit * 2, 20)` before fusion, so RRF
  has enough overlap to rank from without scanning the whole corpus.
- `k = 60` is fixed, not tuned. It is the published RRF default; the gold eval would
  catch a regression if it ever needed changing.
- An empty query bypasses ranking entirely and browses the temporally-filtered set
  (`recallByTemporal`) ordered by recency — there is nothing to rank by relevance.
- The temporal filter is duplicated across `rankBySemantic`, `rankByKeyword`, and
  `recallByTemporal`. That repetition is deliberate: every entry into the candidate
  set must enforce the same valid-time/Current rule, and co-locating it with each
  query keeps "filter-then-fuse" true by construction rather than by convention.

# Reaffirmation: a Fact may cite multiple Sources

A continuous ingestion stream (the Claude Code session hook) re-states the same durable facts over and over — "Zach prefers pnpm" surfaces in many session summaries. The `remember` pipeline previously inserted a new Fact unconditionally: `resolveSupersession` returns `no-supersession` for multi-valued predicates (and unknown predicates default to multi-valued), so nothing closed and a duplicate Current Fact was created on every re-statement. At demo scale (each fact asserted once) this never showed; for an always-on stream it means stacks of identical edges between the same two Entities — the graph bloats and the growth-highlight fires on non-news.

We treat a re-statement of an already-Current Fact (same subject → predicate → object) as a **Reaffirmation**, not a new Fact. A `fact_sources` join table records every Source that has asserted a Fact; the existing `facts.source_id` is retained as the *origin* (first) Source so existing reads, recall, and tests are unaffected, and the table is backfilled from current rows. The dup-check reuses the `(subject, predicate)` current Facts the pipeline already fetches for supersession: if one has the same `object_id`, append a `fact_sources` row instead of inserting. No new Fact, no supersession, no highlight; "reinforced N times" is `count(fact_sources)`.

## Considered options

- **No-op skip** — if an identical Current Fact exists, do nothing. Simplest (no schema change), keeps the graph clean, but throws away the "this belief was reinforced" signal.
- **Allow duplicates** — rejected; it is the bloat failure mode above.

## Consequences

- Fact → Source becomes 1-to-N; `CONTEXT.md` updated (new **Reaffirmation** term; Fact/Source entries note origin + reaffirming Sources).
- Requires a migration (`fact_sources`) plus a backfill; the dup-check needs `object_id` on the fetched current Facts (the resolver's `CandidateFact` currently strips it).
- The viewer does not yet surface reaffirmation count; a natural later enhancement (edge weight / badge).

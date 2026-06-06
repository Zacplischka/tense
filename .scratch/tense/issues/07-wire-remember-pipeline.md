# Wire Extraction + Resolution + Supersession into `remember`

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The convergence slice: replace slice 01's stub with the real ingest pipeline. `remember(text, source)` now runs Extraction → entity resolution → supersession (cardinality) end to end and persists via the atomic transaction. This is where the three independently-built modules become one path.

## Acceptance criteria

- [ ] `remember` runs the full pipeline: extract Facts, resolve their Entities, apply supersession, persist atomically.
- [ ] Ingesting two conflicting Sources on a single-valued Predicate for the same (resolved) subject closes the prior Fact and opens the new Current one — the org-change behavior, end to end.
- [ ] `remember` returns a summary of Entities/Facts created and any Facts superseded.
- [ ] Extraction failures (bad LLM output) surface as a `remember` error without corrupting the graph or crashing the server.
- [ ] End-to-end MCP-adapter integration test (provider stubbed/replayed) asserting the above.

## Blocked by

- `03-supersession-resolver-cardinality`
- `05-extraction`
- `06-entity-resolution`

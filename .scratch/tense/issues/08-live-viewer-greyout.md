# Live viewer (grey-out animation)

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The read-only Next.js viewer that renders the graph from Postgres and makes Supersession visible: Current Facts solid, superseded Facts greyed/dashed, updating live as Facts change. **Demoable on seeded data** (depends on the resolver/store, not on extraction), so the flagship grey-out can be validated early. No UI-side ingestion, no timeline scrubber (both out of scope).

## Acceptance criteria

- [ ] Renders Entities + Facts; Current = `expired_at IS NULL`, **matching the store's partial-index definition** (do not reimplement "current" as `invalid_at IS NULL`).
- [ ] Current Facts solid, superseded Facts greyed/dashed.
- [ ] Live updates via polling; reads a **consistent snapshot** so the viewer never shows a torn state (both edges solid, or neither) mid-supersession.
- [ ] With seeded supersession data, feeding a conflicting Fact visibly greys the old edge and lights the new one.
- [ ] Fixture test where valid-time and transaction-time disagree confirms the correct edges are dashed.

## Blocked by

- `03-supersession-resolver-cardinality`

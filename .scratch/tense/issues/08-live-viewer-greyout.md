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

## Comments

✅ **Completed 2026-06-06.** Read-only Next.js viewer in `viewer/`; flagship
grey-out verified live in a real browser.

- **Renders** Entities + Facts as SVG; deterministic radial layout (stable node
  positions so a Supersession changes only the edge styling). Current solid dark,
  superseded dashed/grey + italic label.
- **Current = `expired_at IS NULL`** everywhere — the snapshot query derives the
  `current` flag from it; `viewer/lib/graph-model.ts` trusts that flag and never
  recomputes from `invalid_at`. Pinned by `test/graph-model.test.ts` (adversarial
  fixture where valid time and transaction time disagree).
- **Consistent snapshot:** `fetchSnapshot` reads entities + facts in one READ
  ONLY REPEATABLE READ transaction → no torn frame mid-Supersession.
- **Live update:** client polls `/api/graph` every 1s.
- **Verified in browser** (Chrome automation): seeded Bob-Current/Alice-superseded
  rendered correctly (DOM asserted `data-current` + dashed/stroke per edge);
  driving `Zach reports-to Dana` into the live DB greyed Bob and lit Dana on the
  next poll. GIF of the transition: `docs/media/greyout.gif`.

**Stack:** separate `viewer/` package (Next 15, React 19, `pg`); reads Postgres
directly. Its relative imports are extensionless (Next bundler resolution), unlike
the NodeNext server. No UI-side ingestion, no timeline scrubber (out of scope).

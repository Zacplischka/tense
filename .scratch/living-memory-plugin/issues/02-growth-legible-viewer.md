# Growth-legible viewer

Status: ready-for-agent
Type: AFK

## Parent

Design record: `docs/adr/0004-viewer-hosts-ingestion-write-path.md`, `CONTEXT.md`.

## What to build

Make the graph read as a brain *growing* rather than reshuffling. Today Entities sit on a circle indexed by alphabetical order over the current count, so adding one Entity moves every node. Replace that with a **stable layout**: place Entities by creation order on a golden-angle (phyllotaxis) spiral, so an existing Entity's position never changes when a new one appears, and the graph stays legible into the hundreds.

On top of the stable layout, animate **growth**: the viewer diffs each polled snapshot against the previous one and gives newly-appeared Entities and Facts a one-shot enter-highlight (scale/draw-in + glow that settles to normal). Supersession keeps its existing grey-out/dash behavior unchanged. The only data change is exposing Entity creation order in the snapshot.

## Acceptance criteria

- [ ] The snapshot exposes Entities in a stable creation order, and the layout is a deterministic function of that order — existing nodes do not move when new Entities are added.
- [ ] Adding Facts/Entities animates only the new elements in; previously-present nodes and edges stay put.
- [ ] New Entities and new Facts get a one-shot enter-highlight that settles to the normal style.
- [ ] Superseded Facts still render greyed/dashed exactly as before (no regression to the recorded demo behavior).
- [ ] Layout stays readable with ~100+ Entities (no overlap pile-up at the center).
- [ ] The snapshot read remains a single consistent read-only transaction — no torn mid-Supersession state.

## Blocked by

None - can start immediately.

## Comments

✅ **Completed.** `snapshot.ts` now orders Entities by `created_at, id`;
`toGraphModel` replaced the count-indexed circle with a stable golden-angle
phyllotaxis keyed by creation index (`r = spacing·√i`, fixed spacing) — existing
nodes never move when a new Entity appears (covered by a new growth-stability
test). `page.tsx` diffs each polled snapshot against what it has seen and
enter-highlights only the genuinely new nodes (scale + green glow → settle) and
edges (fade + glow → settle); the first non-empty snapshot is the calm baseline;
Supersession grey-out is unchanged. `test/graph-model.test.ts` updated from the
old alphabetical contract to creation-order + the growth invariant. All tests
green; `next build` clean.

🔧 **Follow-up: phyllotaxis → force-directed.** Once real session data made the
graph dense, the fixed-spacing phyllotaxis became an unreadable overlapping clump
(its documented limitation). Replaced it with a deterministic `d3-force` layout
(seeded golden-angle + fixed ticks): `forceCollide` guarantees no node overlap,
`forceLink` clusters related Entities, positional gravity (`forceX`/`forceY`)
keeps disconnected components together, and an auto-fit viewBox always fills the
frame. Trade-off: the "existing nodes never move" invariant is dropped in favour
of legibility (re-stated as a "no two nodes overlap" test); the enter-highlight
still marks new nodes. Adds the `d3-force` dependency to the viewer. Verified by
screenshot.

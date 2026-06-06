# Demo seed + recording

Status: ready-for-human
Type: HITL

## Parent

`.scratch/tense/PRD.md`

## What to build

The flagship 3-beat org-change demonstration and its recording: seed Sources → live grey-out → current-vs-`as_of` QA with the fair-baseline contrast. The recording is the portfolio artifact, so it must be **engineered against the demo-killers** the reviewers flagged.

## Acceptance criteria

- [ ] Seed script loads the 3-beat org-change Sources.
- [ ] **Record with pinned/replayed extraction** so the only live things on camera are the resolver + viewer (no live-extraction nondeterminism poisoning the "deterministic" demo).
- [ ] **Golden single-entity assertion**: the demo subject resolves to one Entity across all Sources before recording (so the old edge actually greys out instead of forking).
- [ ] Beat 1 (graph grows) → Beat 2 (edge greys out live, new edge lights up) → Beat 3 (`recall` current vs `as_of` past, contrasted with the fair vector baseline).
- [ ] Recording captured; narration references the "why no graph DB" point.

## Blocked by

- `08-live-viewer-greyout`
- `09-point-in-time-recall`
- `13-eval-harness-fair-baseline`

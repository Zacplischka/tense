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

## Comments

⚙️ **AFK deliverables done 2026-06-06; final recording is the human's.**

- `scripts/seed-demo.ts` (`pnpm seed:demo [beat2|all]`) loads the 3-beat
  org-change story with **pinned/replayed extraction** (StubExtractor, no live
  LLM) — only the resolver + viewer are live, so the demo is deterministic.
- **Golden single-entity assertion** runs after Beat 1: Zach → exactly 1 Entity,
  or the seed fails loudly (no forked grey-out on camera).
- **Deterministic dry-run reproduced all 3 beats:** Beat 1 graph grows (3 solid
  edges); Beat 2 `reports-to` Alice greys (`invalid_at`=2024-06-01) while Bob
  lights up; Beat 3 contrast — Tense recall→Bob, as_of 2024-03→Alice, fair
  baseline→Bob (wrong for the past). Grey-out verified in-browser; GIF at
  `docs/media/greyout.gif`.
- enableContradiction is OFF for the seed (cardinality only) so the on-stage
  supersession fires every time.

**Remaining (HITL):** capture the polished screen recording; narration references
the "why no graph DB" point (see README). DB left at the Beat-1 start state.

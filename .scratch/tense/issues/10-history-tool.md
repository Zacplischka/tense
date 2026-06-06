# `history` tool

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The supersession-chain module and its MCP `history` tool: given a subject (and optional Predicate), return the full chain of past and present Facts — the "show your work" view that surfaces the differentiator in one call.

## Acceptance criteria

- [ ] `history(entity, predicate?)` returns all Facts (Current + superseded) for the subject, with their validity intervals and Sources.
- [ ] **Ordering key is specified** (e.g. by `valid_at`, transaction time as tiebreak) and consistent.
- [ ] Exposed as an MCP tool over stdio.
- [ ] Test: after an org-change supersession, `history(subject, predicate)` returns `[closed Fact, Current Fact]` in the defined order.

## Blocked by

- `07-wire-remember-pipeline`

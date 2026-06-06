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

## Comments

✅ **Completed 2026-06-06.** Verified live over MCP.

- `store.history(subjectId, predicate?)` + `src/retrieval/history.ts`
  (`history(deps, entity, predicate?)`) — resolves the subject by name (variants
  included), returns the full chain (Current + superseded) with intervals +
  Sources.
- **Ordering:** `COALESCE(valid_at, created_at) ASC, created_at ASC` — chronological
  by valid time, transaction time as fallback/tiebreak, so a closed Fact precedes
  the Current one that replaced it.
- MCP `history` tool exposed over stdio (tools/list now: history, recall, remember).
- Tests: chain order `[Alice closed, Bob current]`, predicate narrowing, variant
  resolution + unknown subject → []. Live MCP call returns the chain with sources.
  75 tests green.

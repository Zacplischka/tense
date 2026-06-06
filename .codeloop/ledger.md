# Codeloop ledger

Source of truth for the autonomous improvement loop. Newest log entries last.

## Config

- **Project**: `tense` — temporal memory for AI agents (MCP server over a
  bi-temporal graph on Postgres). TypeScript, ESM, Node ≥20.
- **Package manager**: pnpm (lockfile present); `npm run <script>` also works.
- **Verify gate** (run the subset relevant to a change):
  - typecheck: `npm run typecheck`  (`tsc -p tsconfig.check.json`, noEmit, covers src+test+scripts)
  - build: `npm run build`          (`tsc -p tsconfig.json` → dist)
  - test: `npm test`                (`vitest run` — 23 files / 95 tests at bootstrap)
- **Test prerequisites**: Postgres must be up (`pnpm db:up`; container `tense-pg`,
  pgvector/pg16 on :5432). Vitest globalSetup creates+migrates the isolated
  `tense_test` DB. Most tests are integration tests against real Postgres;
  `fileParallelism: false` (shared DB, serial files).
- **Lint/format**: none configured (no eslint/prettier).
- **Git**: available. Commit each iteration as `codeloop(<dimension>): <summary>`.
- **Baseline (pre-iteration-1)**: typecheck ✓, 95/95 tests ✓, Postgres healthy.

## Saturation

_Per-dimension marginal-value tracker. Increment on V≤2 or reverted outcome;
mark "saturated" after 2 consecutive such outcomes. A fresh-survey iteration
clears all flags._

- correctness/bugs: 0
- tests: 0
- performance: 0
- readability/clarity: 0
- architecture: 0
- docs: 0
- DX/tooling: 0
- accessibility: 0
- cruft-removal: 0
- new-capability: 0

## Backlog

_Discovered opportunities not yet acted on (scout output / deferred ideas)._

- ~~[correctness] `recall`/`history` isError contract~~ — INVALIDATED (iter 2):
  the MCP SDK (`server/mcp.js` L135-142) already wraps every tool handler in
  try/catch and converts thrown errors to `isError` via `createToolError`. The
  server never crashes regardless; `remember`'s explicit catch only customizes
  the message text. Not a bug. Don't "fix" it.
- ~~[tests] Pure helpers `clampLimit`/`formatVector`/`normalizeName`~~ — DONE
  (iter 2): `test/store-helpers.test.ts`.
- [DX/tooling] No ESLint/Prettier; a strict, isolated config would catch drift.
  (Higher blast radius — may flag many existing lines; needs a careful config.)
- [docs] README has no worked example of tool JSON I/O. (Note: verifying it
  means capturing real tool output, not hand-writing JSON — soft gate.)
- ~~[readability] `expireFacts`/`supersedeAndInsert` shared close loop~~ — DONE
  (iter 3): extracted `closeFactsTx`.
- [DX/tooling] (still open) ESLint/Prettier — biggest remaining lever but highest
  blast radius; budget a whole iteration and gate carefully.

## Log

### Iteration 1 · new-capability · mode=generative
- **Change**: Add a `stats` MCP tool + `TemporalGraphStore.graphStats()` — graph
  introspection: entity/source counts, Fact totals (current vs superseded), and a
  per-Predicate breakdown (current/total). Read-only aggregate; new tool honors
  the isError contract.
- **Net-positive**: improves capability/observability (agents & demo can ask
  "what's in my memory?"); protects correctness/existing tools (read-only, no
  writes, no change to remember/recall/history paths). V=4 C=5 S=5.
- **Files**: src/db/store.ts, src/mcp/server.ts, test/stats.integration.test.ts,
  test/mcp-adapter.integration.test.ts (tool-list assertion), README.md.
- **Verification**: `npm run typecheck` ✓ · `npm run build` ✓ · `npm test` ✓
  (24 files / 99 tests; +1 file, +4 tests vs baseline).
- **Commit**: cd6e474
- **Saturation**: none changed.

### Iteration 2 · tests · mode=exploit
- **Change**: Add `test/store-helpers.test.ts` — pure unit tests for the store's
  SQL-safety helpers; export `clampLimit` (was module-private) and document its
  [1,200]-integer contract. 12 tests pinning `clampLimit` (NaN/±Infinity/float/
  negative/over-max), `formatVector` (pgvector literal), `normalizeName`.
- **Net-positive**: improves tests (locks down the LIMIT sanitizer that's
  string-interpolated into queries — a regression there would be a SQL-injection
  surface); protects correctness/behavior (additive new file + one `export`
  keyword + comment; no logic changed). V=3 C=5 S=5.
- **Survey note**: invalidated the iter-1 backlog "recall/history isError"
  candidate — the MCP SDK already converts thrown handler errors to isError, so
  it was a non-bug. Recorded in Backlog.
- **Files**: src/db/store.ts (export + doc only), test/store-helpers.test.ts.
- **Verification**: `npm run typecheck` ✓ · `npm test` ✓
  (25 files / 111 tests; +1 file, +12 tests vs iter 1).
- **Commit**: c0761e4
- **Saturation**: none changed (tests produced V=3, not low-value).

### Iteration 3 · readability · mode=exploit
- **Change**: Extract the duplicated in-transaction close-facts loop shared by
  `expireFacts` (contradiction path) and `supersedeAndInsert` (cardinality path)
  into one private `closeFactsTx(client, closes)` helper in store.ts. The
  identical UPDATE-with-`expired_at IS NULL`-guard loop now lives in one place;
  both callers run it on their own transaction client. Behavior-preserving.
- **Net-positive**: improves readability/clarity (single source of truth for the
  Fact-closing SQL — the kind of duplication that silently drifts); protects
  correctness (no behavior change; both paths fully covered by
  supersession.integration + contradiction.integration tests). V=3 C=4 S=4.
- **Files**: src/db/store.ts.
- **Verification**: `npm run typecheck` ✓ · `npm run build` ✓ · `npm test` ✓
  (25 files / 111 tests — unchanged; behavior preserved). diff +25/-20.
- **Commit**: 47b684a
- **Saturation**: none changed (readability produced V=3, not low-value).

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

- [correctness] `recall`/`history` MCP tools don't honor the server's documented
  "errors returned as isError, never thrown" contract — only `remember` wraps in
  try/catch. (Partially addressed: the new `stats` tool added in iter 1 follows
  the contract; recall/history still bare.)
- [DX/tooling] No ESLint/Prettier; a strict, isolated config would catch drift.
- [tests] Pure helpers `clampLimit`/`formatVector`/`normalizeName` are only
  covered indirectly — add focused unit tests.
- [docs] README has no worked example of tool JSON I/O.

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

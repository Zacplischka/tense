# Codeloop ledger

Source of truth for the autonomous improvement loop. Newest log entries last.

## Steering (user directive — overrides default dimension rotation)

**As of iteration 8 the user asked the loop to focus on FUNCTIONALITY and UX for
the rest of the run.** Prioritize candidates that expand what the system does for
its users and improve their experience:
- **Functionality** = new-capability: richer `remember`/`recall`/tool behavior,
  new MCP tools, surfacing signals the model already tracks but hides.
- **UX** = the agent-facing tool experience (clear outputs, sensible defaults,
  helpful errors, exposed knobs) AND the human-facing **viewer** (Next.js app in
  `viewer/` — the major untouched UX surface; survey it and improve it, verifying
  via its own build/run since it's outside the main vitest gate).

Keep the net-positive bar, verification, and one-coherent-deliverable rules. The
diversify/explore rotation is now secondary to this focus; still avoid needless
repetition. Tests/lint/docs are supporting acts, not the main deliverable, unless
they directly serve a functionality/UX change.

## Config

- **Project**: `tense` — temporal memory for AI agents (MCP server over a
  bi-temporal graph on Postgres). TypeScript, ESM, Node ≥20.
- **Package manager**: pnpm (lockfile present); `npm run <script>` also works.
- **Verify gate** (run the subset relevant to a change):
  - typecheck: `npm run typecheck`  (`tsc -p tsconfig.check.json`, noEmit, covers src+test+scripts)
  - build: `npm run build`          (`tsc -p tsconfig.json` → dist)
  - test: `npm test`                (`vitest run` — 23 files / 95 tests at bootstrap)
  - lint: `npm run lint`            (`eslint . --max-warnings 0`; added iter 7)
  - viewer: `cd viewer && npm run typecheck && npm run build` (separate Next.js
    package, own toolchain; not covered by the main vitest/lint gate. Note: the
    main suite's `test/graph-model.test.ts` DOES import `viewer/lib/graph-model`,
    so viewer type changes there ripple into the main typecheck/test.)
- **Test prerequisites**: Postgres must be up (`pnpm db:up`; container `tense-pg`,
  pgvector/pg16 on :5432). Vitest globalSetup creates+migrates the isolated
  `tense_test` DB. Most tests are integration tests against real Postgres;
  `fileParallelism: false` (shared DB, serial files).
- **Lint/format**: ESLint flat config (`eslint.config.js`) since iter 7 — eslint 10
  + typescript-eslint 8 (non-type-checked). Green on the current tree. No Prettier.
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
- ~~[docs] README worked example of tool JSON I/O~~ — DONE (iter 4): captured
  from a real StubExtractor run, throwaway capture script deleted.
- ~~[readability] `expireFacts`/`supersedeAndInsert` shared close loop~~ — DONE
  (iter 3): extracted `closeFactsTx`.
- ~~[DX/tooling] ESLint~~ — DONE (iter 7): flat config, green with zero functional
  source edits (only removed one dead `eslint-disable` directive). Prettier still
  not configured (deferred — formatting is consistent enough; lower value).
- ~~[new-capability] An `entities` MCP tool~~ — DONE (iter 6): list/search
  Entities with Current-Fact degree, `TemporalGraphStore.listEntities()`.
- [perf] Demo-scale only today: entity-resolver trigram fuzzy match and the
  recall rankers do seq scans (code says "fine at demo scale"). A real perf turn
  = add pg_trgm GIN + ivfflat indexes via a migration. Deferred until scale matters.

_Functionality/UX focus (user steer, iter 8) — prioritize these:_
- [UX] **Viewer** (`viewer/`, Next.js) — surveyed iter 9. DONE so far: rich Fact
  hover tooltip (triple + validity interval + Current/Superseded + reinforcedBy).
  Remaining ideas: a header summary using `stats` (entity/source/fact counts); a
  node-click detail panel listing that Entity's Facts; reinforcedBy → link width;
  error/empty-state polish (empty state exists; error only shows in the header).
- [functionality] Expose `limit` on the `recall` MCP tool (recall() already
  supports it; the tool hides it) — also add an optional `predicate` filter.
- [functionality] `recall`/`entities` could return `reinforcedBy`-sorted or
  filtered views; consider a `min_reinforced` knob now that the signal exists.

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

### Iteration 4 · docs · mode=explore
- **Change**: Add a "Worked example" section to the README — the org-change story
  end to end with the real JSON each MCP tool returns (`remember` ×2 showing
  supersession, `recall` now vs `as_of`, `history`, `stats`). Output was captured
  from a real deterministic StubExtractor run against the test DB (throwaway
  capture script, then deleted), so the documented shapes/values are exact (UUIDs
  abbreviated). 4 mod 4 == 0 → explore: docs was a least-recently-touched (never
  touched) dimension.
- **Net-positive**: improves docs (adopters see the exact MCP response shape —
  the main friction for integrating an MCP server); protects correctness
  (README-only; capture script removed; no src/test change). V=3 C=4 S=5.
- **Files**: README.md.
- **Verification**: ran the capture end-to-end (real tool output) · `npm run
  typecheck` ✓ · `npm test` ✓ (25 files / 111 tests, unchanged).
- **Commit**: 814a93c
- **Saturation**: none changed (docs produced V=3, not low-value).

### Iteration 5 · tests · mode=exploit (fresh survey)
- **Change**: Add `test/recall-hybrid.integration.test.ts` — 3 tests covering
  `recall()`'s hybrid path WITH a provider (the other recall/pipeline tests run
  provider-less, keyword-only). Uses the deterministic BagOfWordsProvider so the
  semantic ranker is live without a network call. Proves filter-then-fuse: (1)
  ingest stores an embedding; (2) a query that names the superseded object
  ("Alice") returns the Current Fact (Bob) via the SEMANTIC ranker — keyword
  can't match Bob and the superseded Alice is filtered out in SQL; (3) the
  temporal filter applies to the semantic branch under `as_of` (returns Alice).
- **Net-positive**: improves tests (pins the project's headline hybrid-retrieval
  mechanism at the function level — previously only exercised incidentally by the
  eval harness); protects correctness/behavior (additive new test file; no source
  change). V=3 C=5 S=5.
- **Fresh survey**: swept the whole tree incl. provider/openrouter, llm-extractor,
  extraction prompts, eval harness + metrics — all clean, no correctness bug. The
  hybrid recall path was the notable function-level coverage gap (now closed).
  ESLint surface measured (see Backlog). Saturation flags cleared (all were 0).
- **Files**: test/recall-hybrid.integration.test.ts.
- **Verification**: `npm run typecheck` ✓ · `npm test` ✓
  (26 files / 114 tests; +1 file, +3 tests vs iter 4).
- **Commit**: 43ad5a6
- **Saturation**: cleared by fresh survey (all 0); tests produced V=3.

### Iteration 6 · new-capability · mode=exploit
- **Change**: Add an `entities` MCP tool + `TemporalGraphStore.listEntities()` —
  list/search Entities, each with its Current-Fact degree (count of Current Facts
  where it is subject OR object), most-connected first; optional case-insensitive
  name-substring filter. Fills the one navigation gap: `recall` returns Facts by
  relevance, `history` needs a known subject, `stats` only aggregates — nothing
  enumerated the Entity vocabulary. Read-only; new tool honors the isError pattern.
- **Net-positive**: improves capability/observability (browse the graph by node);
  protects correctness/existing tools (read-only LEFT JOIN aggregate; no change to
  remember/recall/history/supersession paths). V=3 C=5 S=5.
- **Files**: src/db/store.ts, src/mcp/server.ts, test/entities.integration.test.ts,
  test/mcp-adapter.integration.test.ts (tool-list assertion), README.md.
- **Verification**: `npm run typecheck` ✓ · `npm run build` ✓ · `npm test` ✓
  (27 files / 118 tests; +1 file, +4 tests vs iter 5).
- **Commit**: ad6a4d5
- **Saturation**: none changed (new-capability produced V=3, not low-value).

### Iteration 7 · DX/tooling · mode=exploit
- **Change**: Add ESLint (the thrice-deferred lever). Flat `eslint.config.js`
  (eslint 10 + typescript-eslint 8, non-type-checked: js.recommended +
  tseslint.recommended + node globals), `lint` script (`eslint . --max-warnings 0`),
  devDeps (eslint, typescript-eslint, @eslint/js, globals). Tuned to pass green on
  the current tree with two deliberate choices documented in-config:
  `no-empty:{allowEmptyCatch}` (genuine best-effort paths) and `no-explicit-any:off`
  (pg/HTTP boundary + test helpers). Only functional source touch: removed one dead
  `eslint-disable no-console` directive in a smoke test (what `--fix` would do).
- **Net-positive**: improves DX/tooling (standard static analysis now gates the
  repo; catches drift `tsc` doesn't); protects all code axes (config + devDeps only,
  zero behavior change; fully revertible). V=4 C=4 S=3.
- **Files**: eslint.config.js (new), package.json (script + devDeps), pnpm-lock.yaml,
  test/extraction.smoke.integration.test.ts (dead directive removed).
- **Verification**: `npm run lint` ✓ (0 errors, 0 warnings) · `npm run typecheck` ✓
  · `npm run build` ✓ · `npm test` ✓ (27 files / 118 tests, unchanged).
- **Commit**: e95343b
- **Saturation**: none changed (DX/tooling produced V=4, not low-value).

### Iteration 8 · new-capability (functionality) · mode=exploit
- **User steer**: mid-run the user redirected the loop to FUNCTIONALITY + UX (see
  top-of-ledger Steering). This overrode the explore-turn's least-recently-touched
  mechanic (would have been a perf index); picked a functionality deliverable.
- **Change**: Surface provenance strength to readers — add `reinforcedBy` (count
  of distinct Sources asserting a Fact, origin + Reaffirmations per ADR 0005) to
  `RecalledFact`, populated via a correlated subquery in the shared `RECALL_SELECT`
  so it flows through `recall`, `history`, the empty-query browse, and `allFacts`.
  The signal was tracked (fact_sources) but invisible; now an agent can weigh a
  multiply-confirmed Fact above a single mention.
- **Net-positive**: improves functionality + agent UX (richer, trust-aware reads);
  protects correctness/existing readers (additive backwards-compatible field;
  shared read path but every consumer still works — full suite green). V=4 C=4 S=4.
- **Files**: src/db/store.ts (RecalledFact + RECALL_SELECT + mapRecalledRow),
  test/recall-provenance.integration.test.ts (new), README.md (worked example).
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (28 files / 121 tests; +1 file, +3 tests vs iter 7).
- **Commit**: 2736617
- **Saturation**: none changed (functionality produced V=4).

### Iteration 9 · UX (viewer) · mode=exploit (user-steered)
- **Change**: Rich Fact tooltip on link hover in the viewer. The snapshot already
  fetched validity intervals but the UI never showed them, and iter-8's
  `reinforcedBy` wasn't surfaced to humans at all. Now hovering an edge shows
  `subject → predicate → object`, Current/Superseded, the valid interval
  (`valid <from> → now`/`<to>`), and `· N source(s)`. Enriched `fetchSnapshot`
  (JOIN entity names + fact_sources count), threaded subject/object/validAt/
  invalidAt/reinforcedBy through `SnapshotFact` (optional fields) → page.tsx link
  objects → Graph `linkLabel`; HTML-escaped names. `reinforcedBy` added to the memo
  signature so a Reaffirmation refreshes the tooltip without moving nodes.
- **Net-positive**: improves UX (surfaces Tense's bi-temporal + provenance signal
  in the human UI); protects correctness (additive; node-position stability and the
  Current-from-`expired_at` rule unchanged; graph-model test still green). V=4 C=4 S=4.
- **Files**: viewer/lib/graph-model.ts, viewer/lib/snapshot.ts, viewer/app/page.tsx,
  viewer/components/Graph.tsx.
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓ (28 files / 121, unchanged)
  · data-path smoke (throwaway, deleted): `fetchSnapshot` returns subject/object +
  reinforcedBy, reaffirmed Fact shows reinforcedBy=2.
- **Commit**: 1fc6f5f
- **Saturation**: none changed (UX produced V=4).

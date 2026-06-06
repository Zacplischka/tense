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
- [UX] **Viewer** (`viewer/`, Next.js). DONE: rich Fact hover tooltip (iter 9);
  node-click detail panel (iter 11); reinforcedBy → link width (iter 13);
  point-in-time as-of scrubber (iter 15, via pure `snapshotAsOf`) — the headline
  bi-temporal capability made visual; accessibility pass (iter 16: textarea label,
  aria-live status, graph role=img+label, panel landmark). Remaining (lower value):
  a header summary using `stats`; error-state polish (error only shows in header).
- ~~[functionality] Expose `limit` + `predicate` on `recall`~~ — DONE (iter 10):
  threaded through recall() + the 3 store rankers + the MCP tool; predicate
  normalized to slug.
- ~~[functionality] `min_reinforced` recall knob~~ — DONE (iter 12): trust
  threshold filtered in SQL across the 3 rankers + exposed on the MCP tool.
- ~~[functionality] `sources` MCP tool~~ — DONE (iter 14): enumerate ingested
  Sources (label, preview, ingest time, Facts-cited count); completes the
  introspection trio stats/entities/sources. `TemporalGraphStore.listSources()`.
- ~~[functionality] surface entity-resolution decisions~~ — DONE (iter 17):
  `remember` now returns `entitiesResolved` (new/exact/fuzzy + similarity); fuzzy
  merges shown in the viewer status. Surfaces a hidden, consequential signal.
- ~~[functionality] MCP tool annotations~~ — DONE (iter 18): readOnlyHint on the 5
  read tools; remember readOnlyHint:false + destructiveHint:false (advertises the
  never-deletes invariant). Standards-based agent-UX metadata.
- ~~[functionality] `preview` (dry-run remember)~~ — DONE (iter 19): read-only
  `previewRemember()` + MCP tool; reuses the pure `resolveSupersession` so it
  agrees with `remember`. Reports would-create/supersede/reaffirm + entitiesResolved.
- [functionality] (smaller, remaining) `reinforcedBy`-sorted recall / a `reinforcedBy`
  tiebreak in RRF — but ranking changes touch the eval headline; treat with care.

_Status (iter 20 fresh survey + SCOUT): the codebase is mature — 7-tool MCP
surface (remember/preview/recall/history/stats/entities/sources, all annotated),
rich accessible viewer (tooltip/panel/link-width/as-of scrubber), 159 tests,
lint-clean, eval headline guarded by a deterministic test. The functionality/UX
wells are genuinely drawn down. No candidate cleared the net-positive bar without
either a 4th-straight functionality turn, a risky resolver rewrite, or V≤2 polish
— so iter 20 SCOUTed (no code change). Concrete future opportunities, in rough
priority:_
- ~~[architecture] de-dup preview/remember decision~~ — PARTIALLY DONE (iter 21):
  extracted the shared per-Fact `decideFact()` (reaffirm vs write-with-supersession);
  both remember and preview call it, so preview predicts remember structurally.
  NOT done (and shelved as unsafe): the full `remember = apply(plan())` with an
  up-front read-only plan — remember is INCREMENTAL (each Fact's decision sees the
  live graph after prior Facts in the same batch), so an up-front plan would
  regress intra-batch supersession. Keep remember incremental; decideFact was the
  safe, valuable core.
- [perf] Trigram GIN index on `entities.normalized_name` + an index-accelerated
  resolver. CAUTION: the resolver's 0.4 threshold vs the `%` operator's
  GUC-controlled threshold — do NOT couple correctness to `pg_trgm.similarity_
  threshold`; set it per-query or keep `similarity() >=` as a recheck. Verify with
  EXPLAIN under `enable_seqscan = off`. Index-only (no resolver change) helps just
  the `entities` ILIKE search (V≈2).
- [perf] ivfflat index on `facts.embedding` for `rankBySemantic` — approximate NN;
  needs `lists` tuning + a recall-quality check vs exact. Scale-only.
- [functionality] reinforcedBy-influenced recall ranking (RRF tiebreak). Now
  lower-risk: the eval headline is guarded by eval-harness.integration.test.ts.
  Still marginal (only affects ties) and debatable as a heuristic.
- [UX/viewer] stats-backed header summary + a clearer "connection lost" banner
  on poll failure (today only a faint header ⚠). Low value; bundle if wanted.
- [DX] Prettier (formatting is consistent enough that ESLint suffices; low value).

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

### Iteration 10 · new-capability (functionality) · mode=exploit (fresh survey, user-steered)
- **Change**: Make `recall` controllable — add a `predicate` filter and expose
  `limit`. Threaded an optional `predicate` (normalized to the canonical slug, so
  "Reports To" matches "reports-to") through `recall()`, the three store rankers
  (`rankByKeyword`, `rankBySemantic`, `recallByTemporal` — rewritten to build
  clause/param arrays so indices stay correct; SQL identical when predicate is
  null), and the MCP `recall` tool (new `predicate` + `limit` args). `recall()`
  already supported `limit`; the tool had hidden it.
- **Net-positive**: improves functionality + agent UX (scoped, capped retrieval —
  "top-N reports-to facts about X"); protects correctness (predicate is optional &
  additive; null-predicate SQL byte-identical to before; full suite + eval green).
  V=4 C=4 S=4.
- **Fresh survey**: re-swept with the functionality/UX lens; codebase still clean,
  no correctness bug. Saturation flags cleared (all 0).
- **Files**: src/db/store.ts (3 rankers), src/retrieval/recall.ts, src/mcp/server.ts,
  test/recall-controls.integration.test.ts (new), README.md.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (29 files / 127 tests; +1 file, +6 tests vs iter 9).
- **Commit**: d2da0c2
- **Saturation**: cleared by fresh survey (all 0); functionality produced V=4.

### Iteration 11 · UX (viewer) · mode=exploit (user-steered)
- **Change**: Click-to-inspect detail panel in the viewer. Clicking a node opens a
  right-side panel listing that Entity's Facts — direction (← / →), counterpart,
  Current/Superseded, validity interval, and reinforced-by count — Current first.
  Core derivation is a pure, unit-tested `factsForEntity(snapshot, id)` (no extra
  query — reuses the snapshot already in hand). Graph gains `selectedId`/`onSelect`
  (click a node to select, background to clear) and rings the selected node.
- **Net-positive**: improves UX (entity-centric drill-down — the persistent
  complement to iter 9's transient edge tooltip); protects correctness/graph
  behavior (additive; node-position stability + Current-from-`expired_at` rule
  untouched; React-escaped panel). V=4 C=4 S=4.
- **Files**: viewer/lib/graph-model.ts (factsForEntity), viewer/components/Graph.tsx
  (select props + handlers + selected ring), viewer/app/page.tsx (state + panel +
  FactRow), test/entity-facts.test.ts (new, main gate).
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓ (30 files / 132 tests;
  +1 file, +5 tests vs iter 10).
- **Commit**: f8b295c
- **Saturation**: none changed (UX produced V=4).

### Iteration 12 · new-capability (functionality) · mode=exploit (user-steered)
- **Change**: Add a `min_reinforced` trust filter to `recall` — return only Facts
  asserted by ≥N Sources (the `reinforcedBy` count). Threaded `minReinforced`
  through `recall()` and the three rankers (`rankByKeyword`/`rankBySemantic`/
  `recallByTemporal`) as an additive clause — a correlated `count(fact_sources)
  >= $n` filtered in SQL *before* the limit, so you still get the top matches that
  clear the bar — and exposed `min_reinforced` on the MCP tool. Completes the
  recall control surface (query · as_of · predicate · limit · min_reinforced).
- **Net-positive**: improves functionality + agent UX (precision/trust-thresholded
  recall for high-stakes use); protects correctness (optional & additive; SQL
  byte-identical when unset; full suite + eval green). V=3 C=5 S=5.
- **Files**: src/db/store.ts (3 rankers), src/retrieval/recall.ts, src/mcp/server.ts,
  test/recall-min-reinforced.integration.test.ts (new), README.md.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (31 files / 137 tests; +1 file, +5 tests vs iter 11).
- **Commit**: 94e295a
- **Saturation**: none changed (functionality produced V=3).

### Iteration 13 · UX (viewer) · mode=exploit (user-steered)
- **Change**: Encode provenance strength as edge thickness in the viewer — a
  Current Fact's link width grows gently with its `reinforcedBy` count (capped),
  while superseded edges stay thin (Current-vs-superseded remains the primary
  read). Logic is a pure, unit-tested `factLinkWidth(current, reinforcedBy)` wired
  into the graph's `linkWidth`. Also refreshed the header hint ("thicker = more
  sources · … · click a node") — the iter-11 click-panel previously had no hint.
- **Net-positive**: improves UX (well-confirmed Facts read as bolder at a glance —
  passive complement to the on-demand tooltip/panel); protects graph behavior
  (additive width fn; layout/forces unchanged; superseded stays thin). V=3 C=5 S=5.
- **Files**: viewer/lib/graph-model.ts (factLinkWidth), viewer/components/Graph.tsx,
  viewer/app/page.tsx (hint), test/graph-model.test.ts (+4 factLinkWidth cases).
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓ (31 files / 141 tests;
  +4 tests vs iter 12).
- **Commit**: 0d1bec5
- **Saturation**: none changed (UX produced V=3).

### Iteration 14 · new-capability (functionality) · mode=exploit (user-steered)
- **Change**: Add a `sources` MCP tool + `TemporalGraphStore.listSources()` —
  enumerate ingested Sources newest-first, each with its label, ingest time, a
  ≤200-char text preview, and how many Facts cite it (origin or Reaffirmation).
  Source is a first-class domain concept (CONTEXT.md) that nothing could list;
  this completes the introspection surface: `stats` (aggregate), `entities`
  (nodes), `sources` (provenance inputs). Read-only; honors the isError pattern.
- **Net-positive**: improves functionality + agent UX (provenance audit — "what
  raw text have I seen, how informative was each?"); protects existing tools
  (read-only; no write-path or recall change). V=3 C=5 S=5.
- **Files**: src/db/store.ts (SourceSummary + listSources), src/mcp/server.ts,
  test/sources.integration.test.ts (new), test/mcp-adapter.integration.test.ts
  (tool-list assertion), README.md.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (32 files / 145 tests; +1 file, +4 tests vs iter 13).
- **Commit**: 40f1e35
- **Saturation**: none changed (functionality produced V=3).

### Iteration 15 · UX (viewer) · mode=exploit (fresh survey, user-steered)
- **Change**: Point-in-time scrubber in the viewer — pick an "as of" date and the
  graph re-renders to the state VALID at that instant (Tense's headline capability,
  previously only reachable via `recall(as_of)` / the MCP tools, never visible in
  the UI). Pure, unit-tested `snapshotAsOf(snapshot, asOfMs)` derives the valid-at-T
  graph client-side from the snapshot already in hand (no API change). page.tsx
  gains an `asOf` date input + Live reset; the legend/status switch to "Valid then
  (N)" / "as of <date>". `asOf=""` ⇒ view===snapshot ⇒ identical live behavior;
  node positions persist across live↔as-of (entities pass through unchanged).
- **Net-positive**: improves UX + showcases core functionality (interactive
  bi-temporality — scrub the org-change story and watch the Current edge change);
  protects the live view (additive; pure client-side transform; no backend touch).
  V=4 C=4 S=4 (exceptional → clears diversify).
- **Files**: viewer/lib/graph-model.ts (snapshotAsOf), viewer/app/page.tsx,
  test/snapshot-as-of.test.ts (new, main gate).
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓ (33 files / 151 tests;
  +1 file, +6 tests vs iter 14).
- **Commit**: f28b81f
- **Saturation**: cleared by fresh survey (all 0); UX produced V=4.

### Iteration 16 · accessibility · mode=explore (user-steered)
- **Change**: Viewer accessibility pass (explore: a11y was a never-touched
  dimension; also UX-aligned per the steer). Additive ARIA only: the ingest
  `<textarea>` gets an `aria-label` (it had only a placeholder); the status message
  becomes a persistent `role="status" aria-live="polite"` region so screen readers
  announce ingest results/errors; the `<canvas>` graph wrapper gets `role="img"` +
  a summarizing `aria-label` (entity/current/superseded counts, or "as of <date>");
  the entity detail panel `<aside>` gets an `aria-label`. No logic/behavior change.
- **Net-positive**: improves accessibility (real defects: unlabeled input,
  unannounced status, opaque canvas); protects everything else (additive markup;
  no behavior, no API, no logic change). V=3 C=5 S=5.
- **Files**: viewer/app/page.tsx.
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run lint` ✓ · `npm test` ✓ (33 files / 151 tests, unchanged — page.tsx is
  not exercised by the main suite). No automated a11y gate exists; change is
  additive ARIA, verified by build + review.
- **Commit**: e080525
- **Saturation**: none changed (accessibility produced V=3).

### Iteration 17 · new-capability (functionality) · mode=exploit (user-steered)
- **Change**: Surface entity-resolution decisions, a signal the resolver already
  computes but `remember` threw away. `RememberSummary` gains `entitiesResolved`:
  one entry per distinct input name with `{input, resolvedTo, reason: new|exact|
  fuzzy, similarity?}`. Refactored the pipeline's resolve step to record the
  decision (resolution LOGIC unchanged — same resolve→getEntity→upsert). Flows to
  agents via the MCP `remember` tool automatically; the viewer status now shows
  `· merged Zachery→Zachary` for fuzzy merges. Makes silent mis-merges visible.
- **Net-positive**: improves functionality + trust/debuggability (a wrong fuzzy
  merge corrupts the graph silently — now it's reported); protects the ingest path
  (behavior identical; additive summary field; full suite + eval green). V=4 C=4 S=4.
- **Files**: src/pipeline.ts, viewer/app/page.tsx, README.md (worked example +
  tools table), test/entity-resolution-summary.integration.test.ts (new).
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (34 files / 155 tests; +1/+4) · viewer typecheck ✓ · viewer build ✓.
- **Commit**: 011d882
- **Saturation**: none changed (functionality produced V=4).

### Iteration 18 · new-capability (functionality / agent-UX) · mode=exploit (user-steered)
- **Change**: Add MCP tool annotations (standards-based metadata the SDK + clients
  understand). The five read tools (recall/history/stats/entities/sources) declare
  `readOnlyHint: true` so a client can auto-approve them; `remember` declares
  `readOnlyHint: false, destructiveHint: false, idempotentHint: false` —
  accurately advertising Tense's core never-deletes invariant (supersession
  retains, never removes). All `openWorldHint: false` (local graph).
- **Net-positive**: improves agent-UX/tool-metadata (clients reason about tool
  safety; the non-destructive write property is now machine-readable); protects
  everything (additive annotations; zero behavior change). V=3 C=4 S=5.
- **Files**: src/mcp/server.ts, test/mcp-adapter.integration.test.ts (asserts
  annotations surface via a real client's listTools).
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (34 files / 156 tests; +1 test vs iter 17).
- **Commit**: af79996
- **Saturation**: none changed (functionality produced V=3).

### Iteration 19 · new-capability (functionality) · mode=generative (user-steered)
- **Change**: Add `preview` — a dry-run of `remember`. `previewRemember()` (new
  src/preview.ts) + a read-only MCP `preview` tool report what ingesting text WOULD
  do (factsToCreate/Supersede/Reaffirm + entitiesResolved) WITHOUT writing. Reuses
  the SAME pieces remember uses — extractor, read-only `resolver.resolve`, and the
  PURE `resolveSupersession` — so preview and remember agree by construction; zero
  change to the write path. Documented limitation: simulates against current graph
  state, not intra-batch effects (covers the deterministic cardinality path).
- **Net-positive**: improves functionality + agent-UX (preview a Source's side
  effects — incl. which Facts it would retire — before committing to memory);
  protects remember/correctness (additive, read-only; shared pure decision logic;
  test proves graph unchanged after preview AND that preview predicts remember).
  V=4 C=4 S=4 (exceptional → clears diversify after two functionality turns).
- **Survey note**: marginal items (viewer stats-header / error polish, V=2) stay
  below the bar and `reinforcedBy`-ranking risks the eval; preview was the one
  genuine V≥3 capability left, so generative rather than SCOUT.
- **Files**: src/preview.ts (new), src/mcp/server.ts, test/preview.integration.test.ts
  (new), test/mcp-adapter.integration.test.ts (tool-list + annotations), README.md.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (35 files / 159 tests; +1 file, +3 tests vs iter 18).
- **Commit**: fda0a28
- **Saturation**: none changed (functionality produced V=4).

### Iteration 20 · — · mode=scout (fresh survey)
- **Outcome**: No code change. Fresh whole-codebase survey (src, viewer, eval
  harness/metrics/baseline/run, scripts, dspy) found nothing that clears the
  net-positive bar (V≥3, C≥3, no regression) this turn. The functionality/UX
  backlog is drawn down to V≤2 polish (viewer stats-header / error banner) or
  eval-risky ranking; the explore-target perf index is either V≈2 (index-only) or
  needs a resolver rewrite that risks the correctness-critical fuzzy threshold;
  architecture is well-factored, no dead code, no correctness bug. Per the hard
  rules, SCOUT > forcing a low-value/risky change.
- **Confirmed during survey**: the README headline (Tense beats the fair baseline
  on point-in-time) IS guarded by a deterministic test
  (`eval-harness.integration.test.ts`) — not a doc-only claim.
- **Backlog**: refreshed with 6 concrete, prioritized future opportunities (see
  Backlog → Status iter 20); top exploit candidate is the `remember` plan()/apply()
  refactor (architecture), which also unblocks accurate intra-batch preview.
- **Files**: none (scout) — ledger only.
- **Verification**: n/a (no code change); tree was green at start (lint ✓, 159 tests).
- **Commit**: efe1955 (ledger only)
- **Saturation**: fresh survey cleared all flags (already 0).

### Iteration 21 · architecture · mode=exploit
- **Change**: Extract the shared per-Fact decision into `src/supersession/decide.ts`
  (`decideFact` → `{kind:"reaffirm",factId} | {kind:"write",plan}`), wrapping the
  reaffirmation check + pure `resolveSupersession`. `remember` and `preview` now
  BOTH call it, so a dry-run predicts ingest by construction (same fn), not by
  parallel code that can drift. remember stays incremental (writes per Fact), so
  intra-batch supersession is unchanged.
- **Survey note**: the backlog's `remember = apply(plan())` (up-front read-only
  plan) was inspected and SHELVED as unsafe — it would regress intra-batch
  supersession (remember decides each Fact against the live, mid-batch graph).
  decideFact is the safe core of that item.
- **Net-positive**: improves architecture/clarity (one tested decision; structural
  preview↔remember agreement); protects correctness (remember byte-identical &
  incremental; guarded by supersession + reaffirmation + preview-predicts-remember
  + eval tests). V=3 C=4 S=4.
- **Files**: src/supersession/decide.ts (new), src/pipeline.ts, src/preview.ts,
  test/decide.test.ts (new).
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (36 files / 163 tests; +1 file, +4 tests vs iter 19's 159).
- **Commit**: 91141d3
- **Saturation**: none changed (architecture produced V=3).

### Iteration 22 · docs · mode=exploit
- **Change**: Add `docs/adr/0006-introspection-and-preview-surface.md` — records the
  decision behind the read-only surface added in iters 1–21 (stats/entities/sources
  introspection, `preview` dry-run, tool annotations) and, critically, the
  load-bearing invariants: `preview` predicts `remember` by sharing the pure
  `decideFact`; `remember` stays INCREMENTAL so it is NOT refactored into an
  up-front `plan/apply` (would regress intra-batch supersession — the iter-21
  finding). Captures a non-obvious "do not do this" so a future agent doesn't
  reintroduce the regression. `docs/adr/` is a maintained, agent-consumed decision
  log per CLAUDE.md, so this is on-mission, not ceremony.
- **Net-positive**: improves docs (decision log + agent-navigability; guards a
  future plan/apply regression); protects all code axes (docs-only, no code
  touched). V=3 C=5 S=5.
- **Files**: docs/adr/0006-introspection-and-preview-surface.md (new).
- **Verification**: docs-only — every claim verified against the code (preview
  reuses decideFact; remember incremental; preview test asserts graph-unchanged +
  predicts-remember; annotations; recall knobs). `npm run lint` ✓ (code unchanged);
  full suite not run (markdown-only addition cannot affect it).
- **Commit**: fa4131f
- **Saturation**: none changed (docs produced V=3).

### Iteration 23 · tests · mode=exploit
- **Change**: Add `test/recall-filters-combined.integration.test.ts` — exercises
  recall with `as_of` + `predicate` + `min_reinforced` COMBINED (each was only
  tested in isolation), across all three rankers: keyword + semantic (via a live
  BagOfWordsProvider) and the empty-query browse (`recallByTemporal`). Guards the
  hand-built `$n` param indexing (3 optional clauses × 3 methods) where a combined
  filter could silently drift; also pins that `as_of` excludes null-`valid_at`
  Facts even when other filters would include them.
- **Net-positive**: improves tests (regression guard for the fragile combined
  dynamic-SQL path — the product's core recall correctness, previously untested in
  combination); protects nothing-at-risk (additive test, no source change).
  V=3 C=5 S=5.
- **Files**: test/recall-filters-combined.integration.test.ts (new).
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm test` ✓
  (37 files / 167 tests; +1 file, +4 tests vs iter 21). Build unaffected (no src).
- **Commit**: 6953f71
- **Saturation**: none changed (tests produced V=3).

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
  - **full gate (both packages): `npm run check`** (added iter 40 — chains
    typecheck · lint · build · test · `check:viewer`; needs Postgres up). Use
    `npm run check:viewer` for viewer-only changes. Run the individual scripts
    below for a fast targeted subset.
  - typecheck: `npm run typecheck`  (`tsc -p tsconfig.check.json`, noEmit, covers src+test+scripts)
  - build: `npm run build`          (`tsc -p tsconfig.json` → dist)
  - test: `npm test`                (`vitest run` — 23 files / 95 tests at bootstrap)
  - lint: `npm run lint`            (`eslint . --max-warnings 0`; added iter 7)
  - viewer: `npm run check:viewer` (or `cd viewer && npm run typecheck && npm run build`) —
    separate Next.js package, own toolchain; not covered by the main vitest/lint gate.
    Note: the main suite's `test/graph-model.test.ts` DOES import `viewer/lib/graph-model`,
    so viewer type changes there ripple into the main typecheck/test.
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
- [perf] PARTIALLY DONE (iter 24): pg_trgm GIN index on entities.normalized_name
  (migration 0004) now accelerates the `entities` ILIKE search. STILL deferred: the
  entity RESOLVER's `similarity() >=` fuzzy lookup (needs a GUC-safe query rewrite)
  and an ivfflat index on facts.embedding for rankBySemantic (approximate; needs
  lists tuning). ~~`isCurrent` dead export~~ — REMOVED (iter 32). NOTE (iter 28 scan): a dead-export grep flags
  many types (RememberSummary, RecallOptions, GraphStats, FactChange, ResolverInput,
  …) but those are FALSE POSITIVES — used as param/return types within their own
  module (and are public API). `isCurrent` is the only genuinely dead export. Don't
  "remove" the others.
- [correctness/concurrency] FOUND iter 29, NOT fixed (no clean/safe fix): the ingest
  path reads `currentFactsFor` then inserts in a separate step, with no DB-level
  guard — so two CONCURRENT `remember`s on the same (subject, single-valued
  predicate) could each see "no current Fact" and both insert, leaving two Current
  Facts (cardinality-invariant violation). NOT triggered by the stdio MCP server
  (single client, serial) or the single-user viewer. A blanket `UNIQUE … WHERE
  expired_at IS NULL` is WRONG (multi-valued predicates legitimately have many
  current Facts; cardinality is app-level, not in the schema). Real fixes (per-
  subject `pg_advisory_xact_lock`, or a per-predicate partial unique index) touch
  the demo-critical write path for a non-triggered race → deferred, not forced.
  DOCUMENTED in `docs/adr/0007-ingest-assumes-a-single-writer.md` (iter 30) — the
  single-writer assumption + why the naive fixes are wrong + the fix path if an
  always-on/multi-client ingest stream makes concurrency real.

_Functionality/UX focus (user steer, iter 8) — prioritize these:_
- [UX] **Viewer** (`viewer/`, Next.js). DONE: rich Fact hover tooltip (iter 9);
  node-click detail panel (iter 11); reinforcedBy → link width (iter 13);
  point-in-time as-of scrubber (iter 15, via pure `snapshotAsOf`) — the headline
  bi-temporal capability made visual; accessibility pass (iter 16: textarea label,
  aria-live status, graph role=img+label, panel landmark); keyboard/AT entity index
  (iter 27 — focusable name-sorted chips below the graph open the detail panel, the
  first keyboard path into the canvas); disconnection banner (iter 34 — a prominent
  role=alert "Disconnected — graph may be stale" when polling fails, so a live tool
  doesn't show frozen data as current). Remaining (low value): a header summary
  using `stats`.
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
- [DX] CI workflow (GitHub Actions running the verify gate + a Postgres service) —
  considered iter 31, NOT added: the repo has NO git remote, so it's speculative
  (nothing would run it), and an Actions workflow can't be verified in this
  environment (no Actions runtime). Revisit if/when a GitHub remote exists.

_Considered & rejected (iter 33, so future turns don't re-chase):_
- A `connections`/`neighbors` MCP tool (bidirectional Current Facts for a resolved
  Entity) — largely COVERED by `recall(entityName)` (FACT_TSVECTOR includes both
  subject and object names, so it already returns Facts where the Entity is the
  object), and a 9th tool overlapping recall risks agent-UX sprawl. Marginal; skip.
- A "factless `remember`" robustness test — ALREADY covered: `sources.integration`
  (iter 14) ingests a 250-char no-predicate Source and asserts it's recorded with
  0 Facts. Not a gap.

_Steady-state note (iter 31): the high/medium-value backlog is exhausted. The
functionality/UX focus (user steer iter 8) is complete; the MCP surface, viewer,
tests, lint, perf index, and 7 ADRs are in place. Remaining items are
deferred-by-decision (concurrency, ADR 0007), risky (resolver/ivfflat perf),
marginal (reinforcedBy ranking, viewer polish, isCurrent cruft), or speculative
(CI w/o a remote). Expect mostly SCOUT until new direction or a real trigger
(e.g. concurrency, scale) appears._

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

### Iteration 24 · performance · mode=explore
- **Change**: Add migration `0004_entities_trgm_index.sql` — a pg_trgm GIN index on
  `entities.normalized_name`. The `entities` tool's name search
  (`normalized_name ILIKE '%q%'`) was an O(n) seq scan (B-tree can't serve a
  leading-wildcard ILIKE); the index serves it from trigrams, so entity
  browse/search scales. Transparent to results; the resolver's `similarity()` path
  is deliberately untouched (its acceleration needs a GUC-safe rewrite — deferred).
  Explore turn → invested in performance (never-touched dimension).
- **Net-positive**: improves performance (a user-facing query path, the standard
  fix); protects correctness (additive idempotent index; results unchanged; full
  suite green). V=3 C=4 S=4.
- **Files**: migrations/0004_entities_trgm_index.sql (new),
  test/entities-index.integration.test.ts (new).
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm test` ✓
  (38 files / 169 tests; +1 file, +2). The new test proves the index EXISTS and
  that the planner USES it (EXPLAIN under enable_seqscan=off contains the index
  name) — functional, not decorative.
- **Commit**: 857d9bb
- **Saturation**: none changed (performance produced V=3).

### Iteration 25 · new-capability (functionality) · mode=exploit (fresh survey)
- **Change**: Add a `changes` MCP tool + `TemporalGraphStore.changesSince(since)` —
  the TRANSACTION-time change feed: Facts the memory LEARNED (`created_at >= since`)
  or RETIRED (`expired_at >= since`) since an instant, newest change first, each
  with `learnedAt`/`retiredAt`. This is the other half of the bi-temporal model —
  *when the system knew*, vs valid-time `recall` (*when it was true*) — which no
  tool could query before; enables incremental sync ("what changed since I last
  checked?"). Added `f.created_at AS tx_created` to the shared RECALL_SELECT (benign
  extra column; `mapRecalledRow` unchanged) so changesSince reuses it.
- **Fresh survey**: re-examined the model from scratch — the gap was that
  transaction time (created_at/expired_at), half the bi-temporal model, was
  query-invisible. Saturation flags cleared (all 0).
- **Net-positive**: improves functionality (completes the bi-temporal query
  surface; incremental-sync capability); protects correctness/existing readers
  (additive method + tool + one ignored SELECT column; full suite + eval green).
  V=4 C=4 S=4.
- **Files**: src/db/store.ts (RECALL_SELECT col, FactChange, changesSince),
  src/mcp/server.ts, test/changes.integration.test.ts (new),
  test/mcp-adapter.integration.test.ts (tool-list + annotations), README.md.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (39 files / 174 tests; +1 file, +5 tests vs iter 24).
- **Commit**: bd59b0f
- **Saturation**: cleared by fresh survey (all 0); functionality produced V=4.

### Iteration 26 · docs · mode=exploit
- **Change**: Extend the README "Worked example" with steps 7 (`preview`) and 8
  (`changes`) — the two distinctive tools the example didn't cover. Captured from a
  real deterministic run (StubExtractor) so the shapes/values are exact (UUIDs +
  transaction-time stamps abbreviated; the `changes` example notes the recall
  fields it omits for brevity). Shows the dry-run output (factsToCreate/Supersede +
  entitiesResolved) and the transaction-time feed (learnedAt/retiredAt), with a
  note on the valid-time vs transaction-time split.
- **Net-positive**: improves docs (adoption surface for the non-obvious distinctive
  capabilities — their one-line table entries don't convey the output shapes);
  protects all code axes (docs-only). V=3 C=4 S=5. Diversifies off perf/new-cap and
  documents the functionality shipped in iters 19/25.
- **Files**: README.md.
- **Verification**: docs-only; examples captured from a real run (throwaway script,
  deleted). `npm run lint` ✓ (code unchanged); full suite not run (markdown-only).
- **Commit**: 7ac4be4
- **Saturation**: none changed (docs produced V=3).

### Iteration 27 · accessibility (UX) · mode=exploit
- **Change**: Add a keyboard-/screen-reader-navigable entity index to the viewer —
  a labeled `<nav aria-label="Entities">` of focusable, name-sorted chip `<button>`s
  below the graph; selecting one (click or Tab+Enter) opens the existing detail
  panel and rings its node, with `aria-pressed` conveying selection. Closes the
  mouse-only gap: the `<canvas>` graph isn't focusable, so keyboard/AT users
  previously had NO interactive path to inspect an Entity (iter 16 added only a
  summary label). Reuses `selectedId`/`setSelectedId` + the panel; additive.
- **Net-positive**: improves accessibility + UX (first keyboard path into the
  graph; also a fast name-based index for everyone); protects existing behavior
  (additive section; graph/panel/selection unchanged). V=3 C=4 S=4.
- **Files**: viewer/app/page.tsx.
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run lint` ✓ · `npm test` ✓ (39 files / 174, unchanged — page.tsx not in the
  main suite). a11y/keyboard verified by reasoning (native buttons + nav landmark +
  aria-pressed); no automated a11y harness exists.
- **Commit**: 04af71b
- **Saturation**: none changed (accessibility produced V=3).

### Iteration 28 · readability · mode=explore
- **Change**: DRY the grown `src/mcp/server.ts` (8 tool handlers). Extracted three
  module helpers — `jsonResult(value)` (the `{content:[{type:text, JSON.stringify}]}`
  success shape), `errorResult(message)`, and `toolError(label, err)` — and applied
  them across every handler, removing the repeated formatting + try/catch boilerplate.
  Behavior byte-identical (same JSON output, same isError messages incl. the
  invalid-date ones).
- **Explore note**: 28 mod 4 == 0. Least-recently-touched dim is cruft-removal, but
  it has no eligible candidate (only `isCurrent`, V≈2; see Backlog note — the other
  "dead" exports are false positives). Next-most-neglected dim with a real candidate
  is readability (last touched iter 3) → server.ts de-dup.
- **Net-positive**: improves readability/maintainability (one place for the tool
  result shape; ~8 handlers shrink from ~8 lines to ~3); protects correctness (the
  product's MCP interface — behavior preserved; guarded by mcp-adapter + every
  per-tool integration test asserting exact JSON AND isError cases). V=3 C=4 S=4.
- **Files**: src/mcp/server.ts.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (39 files / 174 tests, unchanged — behavior byte-identical).
- **Commit**: 12acd5c
- **Saturation**: none changed (readability produced V=3).

### Iteration 29 · — · mode=scout
- **Outcome**: No code change. Diversify blocked accessibility(27)/readability(28);
  surveyed the rest and nothing cleared the net-positive bar without forcing:
  new-capability would be speculative sprawl (the query/write/introspection surface
  is complete); UX (stats-header / error banner), cruft (`isCurrent`), DX (Prettier)
  are all V≈2; perf is risky (resolver rewrite) or scale-only (ivfflat); and the one
  real correctness finding (a concurrent-ingest race) isn't triggered in
  single-client usage and has no clean/safe fix. Per the hard rules, SCOUT > forcing.
- **Finding (recorded in Backlog)**: concurrent `remember`s on the same single-valued
  (subject, predicate) can both insert a Current Fact (read-then-insert isn't atomic;
  no DB guard, and a blanket unique index would break multi-valued predicates).
  Latent, non-triggered; fix touches the demo-critical write path → deferred.
- **Files**: none (scout) — ledger only.
- **Verification**: n/a (no code change); tree green at start (lint ✓, 174 tests).
- **Commit**: 085d1df (ledger only)
- **Saturation**: none changed (no dimension acted on).

### Iteration 30 · docs · mode=exploit
- **Change**: Add `docs/adr/0007-ingest-assumes-a-single-writer.md` — records the
  ingest concurrency model: `remember` reads `currentFactsFor` then writes in a
  separate transaction with no DB guard, so concurrent same-subject single-valued
  ingest can violate the cardinality invariant (the iter-29 finding). Documents the
  single-writer assumption (today's stdio/viewer entry points are serial; the
  always-on session hook is the scenario to watch), WHY the naive fixes are wrong
  (blanket unique index breaks multi-valued; the atomic read+decide+write fix fights
  the store/policy separation, ADR 0001/0002), and the real fix path (per-subject
  advisory lock held by the pipeline). Promotes the finding from the loop's backlog
  into the project's maintained decision log (docs/adr, per CLAUDE.md).
- **Net-positive**: improves docs (records a real, load-bearing architectural
  assumption; prevents both ignoring the race and force-fixing it wrongly); protects
  all code axes (docs-only). V=3 C=5 S=5. Diversifies off readability(28); avoids a
  2nd consecutive scout by capturing genuine value from iter 29's finding.
- **Files**: docs/adr/0007-ingest-assumes-a-single-writer.md (new).
- **Verification**: docs-only; claims verified against the code (separate read/write
  txns; non-unique `idx_facts_current`; store holds no policy). `npm run lint` ✓
  (code unchanged); full suite not run (markdown-only addition).
- **Commit**: 6b15180
- **Saturation**: none changed (docs produced V=3).

### Iteration 31 · — · mode=scout
- **Outcome**: No code change. Diversify blocked docs(30). Surveyed the rest; nothing
  cleared the net-positive bar without forcing: the concurrency fix is deferred by
  ADR 0007 (just decided — overriding it now would be incoherent); a CI workflow is
  speculative (no git remote) AND unverifiable here (no Actions runtime); perf is
  risky/scale-only; new-capability would be sprawl; UX/cruft/DX leftovers are V≈2.
  Per the hard rules, SCOUT > forcing.
- **Findings (recorded in Backlog)**: CI considered-and-deferred (no remote); added a
  steady-state note — the functionality/UX focus is complete and the high/medium
  backlog is exhausted, so most turns will SCOUT until new direction or a real
  trigger (concurrency, scale) appears.
- **Files**: none (scout) — ledger only.
- **Verification**: n/a (no code change); tree green at start (lint ✓, 174 tests).
- **Commit**: 5752a52 (ledger only)
- **Saturation**: none changed (no dimension acted on); 3rd scout of the run (20, 29, 31).

### Iteration 32 · cruft-removal · mode=explore
- **Change**: Remove the dead, unused `isCurrent(fact)` export from
  `src/domain/types.ts` — the codebase's only genuinely-dead export (0 refs; iter-28
  scan). Currency is checked everywhere via `expired_at IS NULL` (SQL) /
  `expiredAt === null`, never this helper, and the `expiredAt` field already
  documents "Null iff the Fact is Current", so the helper was redundant + misleading.
- **Explore note**: 32 mod 4 == 0. Least-recently-touched dim is cruft-removal
  (never acted on); this exercises it with its one genuine item. (DX — the other
  neglected dim — had only Prettier/CI, both V≈2/speculative.)
- **Net-positive**: improves cruft-removal/clarity (declutters a core domain file;
  removes a dead "canonical" helper the code deliberately doesn't use); protects
  everything (0 refs — lint no-unused + typecheck + full suite confirm nothing
  broke; no library API contract, the package ships an MCP binary). V=3 C=5 S=5.
- **Files**: src/domain/types.ts.
- **Verification**: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (39 files / 174 tests, unchanged).
- **Commit**: 83ebc18
- **Saturation**: none changed (cruft-removal produced V=3).

### Iteration 33 · — · mode=scout
- **Outcome**: No code change. Diversify blocked cruft(32). Surveyed for a clean
  V≥3; the two fresh candidates both collapsed on inspection: a `connections`
  bidirectional-entity tool is ~covered by `recall(entityName)` + risks tool sprawl,
  and a factless-`remember` test is already covered by sources.integration (iter 14).
  Everything else remains deferred (concurrency, ADR 0007), risky/scale-only (perf),
  speculative (CI, no remote), or V≈2 (viewer polish, Prettier). SCOUT > forcing.
- **Findings (recorded in Backlog)**: the two considered-and-rejected candidates,
  with reasons, so future turns don't re-chase them.
- **Files**: none (scout) — ledger only.
- **Verification**: n/a (no code change); tree green at start (lint ✓, 174 tests).
- **Commit**: f32cd12 (ledger only)
- **Saturation**: none changed; 4th scout of the run (20, 29, 31, 33) — expected at
  steady state on a mature codebase.

### Iteration 34 · UX (viewer) · mode=exploit
- **Change**: Add a prominent disconnection banner to the viewer. When `/api/graph`
  polling fails, the app kept rendering the last snapshot with only a faint header
  `⚠` — easy to miss while watching the graph, so stale data could be mistaken for
  live. Now a `role="alert"` banner ("⚠ Disconnected from the server — the graph
  below may be stale. Reconnecting…") shows whenever `error` is set and clears
  automatically when a poll succeeds.
- **Net-positive**: improves UX (staleness/trust visibility — core to a live
  monitoring tool; also AT-announced via role=alert); protects behavior (additive,
  conditional on existing `error` state; no data/poll-path change). V=3 C=4 S=5.
- **Files**: viewer/app/page.tsx.
- **Verification**: viewer `npm run typecheck` ✓ · viewer `npm run build` ✓ · main
  `npm run lint` ✓ · `npm test` ✓ (39 files / 174, unchanged). Banner behavior
  verified by review (renders iff `error`; clears on successful poll).
- **Commit**: 38c4b69
- **Saturation**: none changed (UX produced V=3).

### Iteration 35 · — · mode=scout (fresh survey)
- **Outcome**: No code change. Fresh whole-system re-examination found no new V≥3:
  the eval gold set is comprehensive (10 scenarios — dated supersession, null
  valid_at, out-of-order, tied valid_at, must-not-supersede multi-valued, distinct
  subjects, 3-step chain, cross-predicate LLM-judged — plus point-in-time QA), so
  "expand the eval" is NOT a gap; provider/extractor/viewer/store re-reasoned as
  robust (no new bug). Diversify blocked UX(34). Deferred items unchanged in their
  triggers (concurrency/ADR 0007, resolver/ivfflat perf, CI/no-remote). SCOUT > forcing.
- **Finding (recorded)**: eval gold set verified comprehensive — don't treat
  "expand gold set" as a backlog gap.
- **Files**: none (scout) — ledger only.
- **Verification**: n/a (no code change); tree green at start (lint ✓, 174 tests).
- **Commit**: 89251b4 (ledger only)
- **Saturation**: cleared by fresh survey (all already 0); 5th scout (20,29,31,33,35)
  — stable equilibrium on a mature codebase, as expected.

### Iteration 36 · new-capability (functionality) · mode=exploit (explore turn)
- **Change**: `remember`'s summary now tags every superseded Fact with WHY it
  closed — `reason: "cardinality" | "contradiction"`. Surfaces a previously hidden
  signal: the LLM-judged cross-Predicate contradiction path is ON by default in the
  agent-facing deps (`remember-deps.ts`), so a real client could see a Fact retired
  with a DIFFERENT predicate than the one it just stated (e.g. state "left Acme" →
  "works-at Acme" superseded) and had no way to tell that apart from a routine
  same-Predicate cardinality update. Now it's explicit. Updated the `remember` MCP
  tool description to advertise the flag (agent-UX).
- **Net-positive**: improves functionality (surfaces a hidden, agent-consumable
  signal — the steering's explicit example). Protects correctness, tests, the
  deterministic demo (contradiction off there → only "cardinality" appears).
  V=3 C=4 S=4.
- **Why this over the explore-nudge dimension**: explore (36%4==0) points at the
  least-recently-touched dim (DX/tooling, iter 7), but the user steering makes
  functionality/UX primary and rotation secondary — and this is squarely
  "surface a hidden signal." Diversify satisfied (last two: UX 34, scout 35).
- **Design / blast radius**: new `SupersededFact extends FactSummary` type;
  `RememberSummary.factsSuperseded` retyped. Additive — preview has its OWN types
  (`RememberPreview`/`PreviewFact`, untouched); the viewer reads only
  `factsSuperseded.length` (backward-compatible); no test deep-equals the entry
  shape. Two call sites set the reason (cardinality branch, contradiction branch).
- **Files**: src/pipeline.ts (SupersededFact + 2 reason tags), src/mcp/server.ts
  (remember description), test/pipeline.integration.test.ts (cardinality-reason
  assertion + new cross-Predicate contradiction-through-pipeline test with inline
  extractor + judge double).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (39 files / 175 tests, +1 new). → pass.
- **Commit**: 9eaaa1e
- **Saturation**: new-capability/functionality active (V=3) — no flag change.

### Iteration 37 · UX (viewer) · mode=exploit
- **Change**: carried iter-36's supersession `reason` into the human-facing viewer.
  Extracted the inline ingest status-message construction into a pure, unit-tested
  `viewer/lib/ingest-summary.ts` (`ingestSummaryMessage`) and added a contradiction
  note: a cross-Predicate retirement now reads `✓ 1 created · 2 superseded (1 by
  contradiction) · 0 reaffirmed` instead of an unexplained count. Closes the
  follow-up flagged at the end of iter 36.
- **Net-positive**: improves UX (viewer makes a consequential, otherwise-invisible
  event legible) AND testability (status-string logic was inline+untested; now a
  pure function with 5 unit tests). Protects correctness (pure refactor of the
  existing string), the fuzzy-merge note, the demo. V=3 C=4 S=5.
- **Design / blast radius**: new pure file `viewer/lib/ingest-summary.ts` (mirrors
  `graph-model.ts` — framework-free, tested by the MAIN suite via
  `test/ingest-summary.test.ts`). `page.tsx` swaps ~12 inline lines for one call +
  one import. Isolated; no API/type/store change.
- **Files**: viewer/lib/ingest-summary.ts (new), viewer/app/page.tsx (use it),
  test/ingest-summary.test.ts (new — counts, contradiction note, merge note, empty).
- **Verification**: main `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓
  (40 files / 180 tests, +5 new) · viewer `npm run typecheck` ✓ · `npm run build` ✓.
  → pass.
- **Commit**: c22b956
- **Saturation**: UX active (V=3) — no flag change.

### Iteration 38 · docs · mode=exploit
- **Change**: synced the README to the iter-36/37 supersession `reason` signal —
  the canonical worked example's `factsSuperseded` entry was stale (no `reason`).
  Added `"reason": "cardinality"` to the example, a one-line explanation of
  cardinality-vs-contradiction (matching the existing `entitiesResolved` note
  style), and tagged the `remember` tools-table row. Keeps the front-door docs
  matching real tool output; serves the recent functionality (steering's docs
  exception).
- **Net-positive**: improves docs accuracy (front door advertises a real
  agent-facing signal). Protects example correctness — kept it on the deterministic
  cardinality demo path (did NOT fabricate a nondeterministic contradiction run);
  the example is backed by a passing assertion in `test/pipeline.integration.test.ts`
  (`reason` === "cardinality" for this exact Zach→Alice→Bob scenario). V=3 C=5 S=5.
- **Why docs (not UX/functionality)**: diversify blocks the last two dims
  (functionality 36, UX 37); docs directly serves them by keeping the example true.
- **Files**: README.md (worked example + explanatory note + tools-table row).
- **Verification**: docs-only (no build/test impact); accuracy cross-checked —
  both README `factsSuperseded` occurrences consistent, example matches the
  passing pipeline test. → pass.
- **Commit**: 6dd6027
- **Saturation**: docs active (V=3) — no flag change.

### Iteration 39 · new-capability (functionality) · mode=exploit
- **Change**: surfaced `learnedAt` (transaction time — when the system learned a
  Fact) on every `RecalledFact`, completing recall's bi-temporal transparency.
  recall already exposed valid time (`validAt`/`invalidAt`) and a lossy `current`
  boolean (transaction-time-derived: IF retired) but never WHEN a Fact entered
  memory — though `RECALL_SELECT` already computed `created_at AS tx_created` and
  dropped it for plain recall. Now mapped through; `FactChange` simplified to
  inherit it (was a redundant redeclaration) and `changesSince` drops the
  now-redundant assignment. `learnedAt` now also rides `history` + `allFacts`.
- **Net-positive**: improves functionality (surfaces the system's core bi-temporal
  "other axis" — tracked but hidden). Protects correctness (ALL 6 mapRecalledRow
  paths use RECALL_SELECT → tx_created always present, learnedAt non-null), the
  `changes` output (JSON unchanged: learnedAt+retiredAt still both present), the
  demo. V=3 C=4 S=4.
- **Why functionality (not UX/docs)**: diversify blocks the last two dims (docs 38,
  UX 37); functionality (36) is open and is the steering's primary focus +
  "surface a hidden signal" example.
- **Design / blast radius**: additive field on RecalledFact. No viewer use (its
  snapshot has its own types); no test deep-equals the shape; eval `allFacts`
  reads object/predicate/current/validAt (unaffected). README is "captured exact",
  so the wall-clock learnedAt needed a caveat tweak (yours will differ).
- **Files**: src/db/store.ts (RecalledFact +learnedAt, mapRecalledRow, FactChange
  simplified, changesSince), test/recall.integration.test.ts (new test: learnedAt
  is a Date, distinct from validAt, consistent with the `changes` feed),
  README.md (both recall examples + caveat + tools-table recall row).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (40 files / 181 tests, +1 new). → pass.
- **Commit**: f42f3bd
- **Saturation**: new-capability/functionality active (V=3) — no flag change.

### Iteration 40 · DX/tooling · mode=explore (fresh survey)
- **Change**: added a unified `check` npm script that runs the FULL verify gate
  across BOTH packages — `typecheck · lint · build · test · check:viewer` — plus a
  standalone `check:viewer` (viewer `typecheck · build`). Scripts reference the
  canonical per-step scripts (DRY) rather than duplicating the commands. Closes a
  real repo-specific footgun: the viewer is a separate Next.js package outside the
  main vitest/lint gate, so viewer changes were easy to forget; now one command
  covers everything.
- **Net-positive**: improves DX/tooling (one command for the whole gate; encodes
  "what's the full gate" in package.json). Regresses nothing — additive scripts,
  no code, no dependency. V=3 C=5 S=5.
- **Why DX/tooling**: explore turn (40%4==0) → least-recently-touched dimension is
  DX/tooling (untouched since iter 7); fresh survey (40%5==0) re-confirmed the gap;
  diversify blocks functionality(39)/docs(38). No git remote → CI stays deferred.
- **Files**: package.json (`check` + `check:viewer`), README.md (quickstart line),
  .codeloop/ledger.md (Config gate updated to lead with `npm run check`).
- **Verification**: ran `npm run check` end-to-end → EXIT=0; all six steps fired in
  order (main typecheck → lint → build → test [40 files/181] → viewer typecheck →
  viewer build [next build ✓]). → pass.
- **Commit**: 313e656
- **Saturation**: ALL flags cleared (fresh survey, iter 40) — all were already 0;
  codebase remains mature/clean.

### Iteration 41 · UX (viewer) · mode=exploit
- **Change**: surfaced `learnedAt` (transaction time) in the viewer's entity detail
  panel — the human-facing parallel to iter 39 (which added it to the recall API).
  The snapshot now also selects `f.created_at`; `SnapshotFact`/`EntityFact` carry
  `learnedAt`; `FactRow` shows "… · learned YYYY-MM-DD" next to the valid interval,
  so the bi-temporal distinction (true-in-world vs when-the-system-learned-it) is
  visible in the UI. Mirrors iter 37 (which surfaced the supersession `reason`).
- **Net-positive**: improves UX (viewer) — makes the system's core "other axis"
  visible where a human inspects Facts. Also fills a test gap: `factsForEntity` was
  imported by the app but untested in the main suite; now has a `describe` block.
  Protects the graph/as-of rendering (learnedAt is additive; `toGraphData` and
  `snapshotAsOf` ignore it) and correctness. V=3 C=4 S=5.
- **Why UX**: diversify blocks the last two dims (DX 40, functionality 39); UX
  (37) is open and is the steering's primary focus.
- **Design / blast radius**: `learnedAt` optional on `SnapshotFact` (matches the
  optional `reinforcedBy` style) so toGraphData test fixtures stay terse; required
  (nullable) on `EntityFact`. snapshot query +1 column. No API/store change.
- **Files**: viewer/lib/snapshot.ts (select created_at + map), viewer/lib/graph-model.ts
  (SnapshotFact/EntityFact + factsForEntity), viewer/app/page.tsx (FactRow renders
  learned date), test/graph-model.test.ts (new factsForEntity describe: learnedAt
  flow, null default, Current-first order).
- **Verification**: `npm run check` → EXIT=0 (40 files / 184 tests, +3 new; viewer
  typecheck + build ✓). → pass.
- **Commit**: 16fbde2
- **Saturation**: UX active (V=3) — no flag change.

### Iteration 42 · new-capability (functionality) · mode=exploit
- **Change**: `stats` now tags each Predicate in its breakdown with `cardinality`
  (`single` = a new value supersedes the prior, e.g. reports-to; `multi` = values
  accumulate, e.g. knows) — surfacing the `PredicateRegistry` rule that governs the
  WHOLE supersession model but was invisible to agents. An agent can now predict
  whether a `remember` will supersede or add, from `stats` alone.
- **Net-positive**: improves functionality (surface a hidden, governing signal).
  Protects store purity, correctness, the demo. V=3 C=4 S=5.
- **Architecture note**: the enrichment is merged at the MCP TOOL layer
  (`server.ts`, via `deps.registry.cardinalityOf`), NOT in the store — the store
  holds no supersession policy (ADR 0001/0002). `GraphStats` (store type) is
  unchanged; only the tool's JSON is richer.
- **Why functionality**: diversify blocks the last two dims (UX 41, DX 40);
  functionality (39) is open and is the steering's primary focus.
- **Files**: src/mcp/server.ts (stats handler enrich + description),
  test/mcp-adapter.integration.test.ts (new: stats cardinality single/multi),
  test/stats.integration.test.ts (round-trip test updated to the enriched contract
  — strengthened, not weakened), README.md (stats example + note + tools-table row).
- **Verification**: `npm run check` → EXIT=0 (40 files / 185 tests, +1 net; viewer
  typecheck + build ✓). First run caught a pre-existing round-trip test that
  asserted tool==store output; updated it to the deliberate new contract, re-ran green.
- **Commit**: f74f061
- **Saturation**: new-capability/functionality active (V=3) — no flag change.

### Iteration 43 · tests · mode=exploit
- **Change**: added an MCP-boundary test that the recent agent-facing signals
  survive the real client→server→JSON path: `remember`'s `factsSuperseded[].reason`
  (iter 36) and `recall`'s `learnedAt` serialized as an ISO string (iter 39). These
  were tested at the pipeline/store level but never end-to-end through the wire that
  agents actually consume — a serialization-boundary regression (Date→string, a
  dropped field) would have slipped past the in-process tests.
- **Net-positive**: improves tests (locks the actual product contract — the MCP
  tool JSON — for two README-advertised signals). Serves recent functionality
  (steering's supporting-act exception). Test-only, additive. V=3 C=5 S=5.
- **Why tests**: diversify blocks the last two dims (functionality 42, UX 41);
  tests harden that recent functionality at the boundary it's actually used.
- **Files**: test/mcp-adapter.integration.test.ts (one new boundary test on the
  default/deterministic cardinality path — contradiction reason stays pipeline-level).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓
  (40 files / 186 tests, +1 new). Viewer gate not run (no viewer change). → pass.
- **Commit**: e705112
- **Saturation**: tests active (V=3) — no flag change.

### Iteration 44 · accessibility · mode=explore
- **Change**: made the viewer's entity detail panel keyboard-operable (standard
  disclosure focus pattern). The `<aside>` is now a programmatic focus target
  (tabIndex=-1, outline:none); opening it moves focus into it so keyboard/SR users
  reach the Fact list (the graph canvas isn't focusable); Escape closes it; and
  closing returns focus to the chip that opened it. Chip onClick captures the
  trigger element; the graph (mouse) path clears it so focus just falls back.
- **Net-positive**: improves accessibility (keyboard operability + focus order on
  the primary UX surface — Escape-to-dismiss and focus-into/return were missing).
  Protects the mouse flow (unchanged behavior) and graph/as-of rendering (additive
  refs/handlers only). V=3 C=4 S=5.
- **Why a11y on this explore turn**: explore (44%4==0) → least-recently-touched
  dimension. Architecture (21) is mature — a shared-core refactor would be low-S,
  no safe eligible candidate; performance (24) deferred items are risky/scale-only.
  Accessibility (27) is the eligible least-recently-touched dim, well-isolated, and
  serves the steering's UX surface. Diversify blocks tests(43)/functionality(42).
- **Files**: viewer/app/page.tsx (panelRef/triggerRef + focus effect; aside
  tabIndex/onKeyDown Escape/outline; chip captures trigger; graph onSelect clears it).
- **Verification**: `npm run check:viewer` → EXIT=0 (tsc --noEmit ✓, next build ✓).
  Viewer-only change (page.tsx isn't imported by the main suite); no component-test
  harness exists for focus/keyboard behavior, so verified via typecheck + build
  per the established viewer-a11y pattern (iters 16/27/34). → pass.
- **Commit**: cd8a88c
- **Saturation**: accessibility active (V=3) — no flag change.

### Iteration 45 · new-capability (functionality) · mode=exploit (fresh survey)
- **Change**: `history` (the supersession "show your work" chain) now returns
  `FactChange[]` instead of `RecalledFact[]`, so each link carries `retiredAt` (the
  transaction time the Fact was closed). The chain is mostly retired Facts, so it
  now tells the full bi-temporal story per link — valid interval + `learnedAt` +
  `retiredAt` + `current`. Reuses the EXISTING `FactChange` type (= RecalledFact +
  retiredAt), so recall and the README recall examples are untouched.
- **Net-positive**: improves functionality (completes the transaction-time axis on
  the signature chain view). Protects recall (unchanged), correctness, the demo.
  V=3 C=4 S=4. COMPLETES the bi-temporal surfacing arc: recall has learnedAt (39),
  viewer shows learnedAt (41), changes has both (since bootstrap), history now has
  both — every query tool exposes the full transaction-time axis. No more timestamp
  slicing needed.
- **Fresh survey**: re-read recall.ts (clean filter-then-fuse RRF) and
  entity-resolver.ts (clean exact→fuzzy→short-name guard) away from the recent
  store/viewer cluster — both mature; history's missing retiredAt was the clearest
  remaining functionality gap. Saturation flags cleared (all already 0).
- **Why functionality**: diversify blocks the last two dims (a11y 44, tests 43);
  functionality is steering-primary and open (last 42).
- **Files**: src/db/store.ts (history → FactChange[] + retiredAt map),
  src/retrieval/history.ts (return type + doc), test/history.integration.test.ts
  (retiredAt assertion: closed Fact set, Current null), README.md (history step-5
  note — no longer "same shape as recall"; tools-table history row).
- **Verification**: `npm run check` → EXIT=0 (40 files / 186 tests; viewer
  typecheck + build ✓). → pass.
- **Commit**: ed3a0ce
- **Saturation**: ALL flags cleared (fresh survey, iter 45) — all already 0;
  new-capability active (V=3). Codebase remains mature/clean.

### Iteration 46 · UX (viewer) · mode=exploit
- **Change**: added a filter input to the viewer's Entities index — narrows the
  name-sorted chip list by case-insensitive substring, with a "X of N" count and a
  "no match" empty state. Closes a viewer/agent parity gap: the `entities` MCP tool
  has a `query` filter but the human viewer's chip list had none, so finding one
  Entity in a large graph meant scrolling the capped (maxHeight 120) list.
- **Net-positive**: improves UX (find-an-entity usability as the graph grows;
  parity with the agent surface). Protects the select/keyboard flow (chips
  unchanged — still aria-pressed, focus-capturing) and graph/as-of rendering
  (additive; derived `visibleEntities` only). V=3 C=5 S=5.
- **Why UX (non-timestamp)**: diversify blocks the last two dims (functionality 45,
  a11y 44); UX is steering-primary and open (last 41). The bi-temporal timestamp
  arc completed at iter 45, so this is a deliberately different UX axis.
- **Files**: viewer/app/page.tsx (entityFilter state; derived visibleEntities;
  nav gains a labeled type=search input + empty state; map uses visibleEntities).
- **Verification**: `npm run check:viewer` → EXIT=0 (tsc --noEmit ✓, next build ✓).
  Viewer-only (page.tsx not imported by the main suite); the filter is a trivial
  inline substring match (like the existing inline sort), verified via build. → pass.
- **Commit**: bc13242
- **Saturation**: UX active (V=3) — no flag change.

### Iteration 47 · tests · mode=exploit
- **Change**: extended the MCP-boundary contract test to exercise the `history`
  tool end-to-end over the real client→server→JSON path — the FIRST such coverage
  (history was listed in the tools test but never *called* over MCP; only the
  `history()` function was tested directly). Asserts the chain crosses the wire and
  each link's `retiredAt` (iter-45 contract: closed Fact → ISO string, Current →
  null) serializes. Now one test locks all recently-added agent-facing signals at
  the wire: reason (36), learnedAt (39), history retiredAt (45).
- **Net-positive**: improves tests (first MCP-path coverage of the `history` tool;
  locks the iter-45 return-type change at the boundary agents use). Test-only,
  additive. V=3 C=5 S=5.
- **Why tests (not UX/functionality)**: diversify blocks the last two dims
  (functionality 45, UX 46). Surveyed first: snapshotAsOf, eval metrics,
  factsForEntity, ingest-summary all already tested; CONTEXT.md current — so the
  genuine remaining gap was history's untested MCP path.
- **Files**: test/mcp-adapter.integration.test.ts (extended the boundary test +
  renamed; history call + retiredAt-over-wire assertions).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm test` ✓
  (40 files / 186 tests). Viewer gate not run (no viewer change). → pass.
- **Commit**: fe63c12
- **Saturation**: tests active (V=3) — no flag change.

### Iteration 48 · readability/clarity · mode=explore
- **Change**: extracted a private `mapFactChange(row)` in store.ts (= `mapRecalledRow`
  + `retiredAt`) and used it in both `changesSince` and `history`, which since iter 45
  built the identical `FactChange` shape inline in two places. One construction
  point so the two can't drift; completes the module's mapper family
  (mapFact/mapEntity/mapSource/mapRecalledRow/mapFactChange). Tidied the now-stale
  iter-45 inline comment.
- **Net-positive**: improves readability/maintainability (DRY — single FactChange
  construction; consistent with the module convention). Protects the `changes` and
  `history` output (byte-identical mapping), correctness, the demo. V=3 C=5 S=5.
- **Why readability on this explore turn**: explore (48%4==0) → least-recently-touched
  eligible dimension. Architecture (21) has only a risky shared-core store split
  (low-S, not eligible); performance (24) deferred items are risky/scale-only;
  readability (28) had this concrete, safe DRY. Diversify blocks tests(47)/UX(46).
  (Dead-export scan reconfirmed the iter-28 false-positive pattern — no real cruft.)
- **Files**: src/db/store.ts (new mapFactChange; changesSince + history use it;
  comment tidy).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (40 files / 186 tests, unchanged — pure refactor; both call sites
  covered by changes/history/mcp-boundary tests). → pass.
- **Commit**: 1fe04df
- **Saturation**: readability active (V=3) — no flag change.

### Iteration 49 · UX (viewer) · mode=exploit
- **Change**: made the detail panel's Fact rows navigable — each Fact's counterpart
  Entity is now a button that selects it, turning the panel into a graph-traversal
  tool (click Zach → "reports-to Bob" → click Bob → Bob's facts). `factsForEntity`
  already computed the counterpart id internally; exposed it as `EntityFact.otherId`
  and wired `FactRow` to `setSelectedId`. Complements canvas node-clicking with a
  text/keyboard path (the button is focusable + aria-labelled).
- **Net-positive**: improves UX (explore relationships by traversing Facts; also
  keyboard-accessible). Protects the panel display, the iter-44 focus management
  (selecting a new entity keeps focus in the panel via the existing effect), graph
  rendering. V=3 C=4 S=4.
- **Why UX (non-timestamp)**: diversify blocks the last two dims (readability 48,
  tests 47); UX is steering-primary and open (last 46). Functionality is complete
  (8 tools, all signals surfaced), so this is a distinct UX/navigation axis.
- **Files**: viewer/lib/graph-model.ts (EntityFact.otherId + factsForEntity sets it),
  viewer/app/page.tsx (FactRow counterpart → button + onSelect prop; render passes
  setSelectedId), test/graph-model.test.ts (otherId assertion, both directions).
- **Verification**: `npm run check` → EXIT=0 (40 files / 187 tests, +1; viewer
  typecheck + build ✓). → pass.
- **Commit**: 6e6cc09
- **Saturation**: UX active (V=3) — no flag change.

### Iteration 50 · correctness/robustness · mode=exploit (fresh survey)
- **Change**: `OpenRouterClient.post` now retries transient failures (HTTP
  429/500/502/503/504 and network/transport errors) with exponential backoff
  (default 2 retries, 250ms→500ms; injectable `maxRetries`/`retryDelayMs`).
  Non-transient errors (401/400/…) still throw immediately. Previously a single
  429 mid-extraction failed a whole `remember` (losing that memory); recall already
  degraded to keyword (embed is best-effort) but extraction did not.
- **Net-positive**: improves correctness/robustness on the LIVE LLM path (reliable
  ingestion/recall under rate limits & blips). Protects the success path (returns
  immediately, no extra calls), non-transient errors (no retry — tested), and test
  determinism (retryDelayMs=0 in the test helper). V=3 C=4 S=4.
- **Fresh survey**: looked away from the recent viewer/store cluster — session-hook
  (a Python verify script, out of MCP scope), config/env (clean), and the provider
  (untouched since iter 5). The provider's missing retry was the clearest
  non-obvious robustness gap. Saturation flags cleared (all already 0).
- **Why this dimension**: diversify blocks the last two (UX 49, readability 48);
  robustness on the live path serves the steering's functionality goal (reliable
  remember/recall) without being a timestamp repeat.
- **Files**: src/provider/openrouter.ts (retry loop + maxRetries/retryDelayMs opts +
  RETRYABLE_STATUS/sleep), test/openrouter.test.ts (+4: retry-then-succeed,
  give-up-after-maxRetries, no-retry-on-401, retry-on-network-error; helper delay 0).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (40 files / 191 tests, +4). Viewer gate not run (no viewer change). → pass.
- **Commit**: 89c34d7
- **Saturation**: ALL flags cleared (fresh survey, iter 50) — all already 0;
  correctness/robustness active (V=3). Codebase remains mature/clean.

### Iteration 51 · new-capability (functionality) · mode=exploit
- **Change**: `entities` now returns each Entity's distinct Current-Fact
  `predicates` (sorted) alongside its degree — the Entity's relationship "shape"
  (e.g. Zach → [knows, reports-to]). An agent browsing can see what KINDS of Facts
  touch an Entity and pick its next call (history-by-predicate / recall) without a
  round-trip. Per-Entity analogue of the global predicate breakdown in `stats`.
- **Net-positive**: improves functionality (surface useful structure). Protects the
  existing degree/ordering (unchanged), store purity, the demo. V=3 C=4 S=4.
- **Why functionality**: diversify blocks the last two dims (correctness 50, UX 49);
  functionality is steering-primary and open (last 45). (Also noted a stale README
  "live viewer" section that omits the as-of scrubber/entity filter/detail-panel
  navigation — backlogged as a docs candidate for a future non-functionality turn.)
- **Design / blast radius**: one SQL addition (`array_agg(DISTINCT f.predicate)
  FILTER (WHERE expired_at IS NULL)`; NULL→[] + JS sort for determinism). Additive
  field on EntitySummary; the viewer uses its own snapshot (not listEntities) so no
  viewer impact. Updated the MCP-tool test's explicit Alice assertion to the
  enriched shape (predicates: []) — strengthened, not weakened.
- **Files**: src/db/store.ts (EntitySummary.predicates + query + mapper),
  src/mcp/server.ts (entities description), test/entities.integration.test.ts
  (predicate-shape store test + MCP-tool assertion), README.md (entities row).
- **Verification**: `npm run check` → EXIT=0 (40 files / 192 tests, +1; viewer
  typecheck + build ✓). → pass.
- **Commit**: e16c7ae
- **Saturation**: new-capability/functionality active (V=3) — no flag change.

### Iteration 52 · docs · mode=explore
- **Change**: refreshed the README "live viewer" section, which described only
  grey-out/glow-in/ingestion and omitted every interactive feature added since.
  Added a bullet list documenting: the as-of scrubber (point-in-time rewind — the
  bi-temporal model made visual), the filterable Entity index, the click-to-inspect
  detail panel (valid interval + learnedAt + Source count + clickable counterparts
  + Escape-to-close), and the staleness banner. Closes the gap backlogged in iter 51.
- **Net-positive**: improves docs accuracy (the front door now represents the
  headline viewer — esp. the as-of scrubber, the project's signature demo). Serves
  UX by documenting it. Protects accuracy — every claim cross-checked against the
  implementation (iters 15/27/34/41/44/46/49); described nothing unimplemented.
  V=3 C=5 S=5.
- **Why docs on this explore turn**: explore (52%4==0) → least-recently-touched
  eligible dim. Architecture (21) mature/no-safe-candidate; performance (24)
  deferred/risky; cruft (32) only false-positive exports (iter 28/48); docs (38)
  had this concrete, real gap. Diversify blocks functionality(51)/correctness(50).
- **Files**: README.md ("The live viewer" section).
- **Verification**: docs-only (no build/test impact); section renders cleanly,
  claims verified against the code, tree clean. → pass.
- **Commit**: edf4d56
- **Saturation**: docs active (V=3) — no flag change.

### Iteration 53 · UX (viewer) · mode=exploit
- **Change**: the graph now pans to the selected Entity's node on selection
  (`centerAt`, 600ms). Selecting from the (filterable) Entity index or walking the
  detail panel's counterpart links (iter 49) could ring an OFF-SCREEN node — the
  ring was useless if you couldn't see it. Now selection brings the node into view,
  turning index/panel selection into real graph navigation. Keyed on `selectedId`
  only, so live polling/glow never yanks the camera.
- **Net-positive**: improves UX (selection = navigation; completes the index/panel/
  canvas loop from iters 11/27/46/49). Protects live rendering (no re-center on data
  ticks), node-drag, and the existing repaint/force effects. V=3 C=4 S=4.
- **Why UX (non-timestamp, non-Graph-risky)**: diversify blocks the last two dims
  (docs 52, functionality 51); UX is steering-primary and open (last 49). Surveyed
  the Graph component (mature) — centering the camera on selection was the clear,
  well-isolated remaining gap, distinct from the timestamp arc (done iter 45).
- **Files**: viewer/components/Graph.tsx (one effect: centerAt on selectedId).
- **Verification**: `npm run check:viewer` → EXIT=0 (tsc --noEmit ✓, next build ✓).
  Viewer-only (Graph.tsx not imported by the main suite); canvas/library behavior
  has no component-test harness, so verified via typecheck + build per the
  established Graph pattern (iter 13). → pass.
- **Commit**: d9ba64c
- **Saturation**: UX active (V=3) — no flag change.

### Iteration 54 · — · mode=scout
- **Outcome**: No code change. Diversify blocked UX(53)/docs(52); functionality
  (steering-primary, open) is saturated — verified this turn: the empty-query browse
  orders newest-first (`created_at DESC` / `valid_at DESC`, sensible), `rrf.ts` is
  tested, 8 tools complete, all hidden signals surfaced (reason, learnedAt/retiredAt,
  cardinality, predicate-shape). Supporting dims have thorough coverage / deferred-
  risky items. No candidate cleared V≥3 without forcing or a real cost. SCOUT >
  forcing a borderline change (last scout was iter 35 — not over-frequent).
- **Backlog (discovered this turn)**:
  - [functionality] Enumerate the citing Sources per Fact (which Sources reaffirm
    it, not just the count) — completes provenance. BUT bloats every recall/history
    result + RecalledFact ripple + README churn; better as an opt-in recall flag.
    V2-3 (cost vs value tradeoff — don't force).
  - [functionality] `as_of` on `stats` — point-in-time graph counts (entities/facts/
    predicates as of a past instant). V2 (agents rarely need historical stats).
  - [robustness] Embedding-dimension guard: a non-1536-dim `TENSE_EMBEDDING_MODEL`
    makes `setFactEmbedding` fail — and it's swallowed (best-effort), so semantic
    recall SILENTLY degrades with no error. Validate dim at startup / surface it. V2-3.
  - [a11y] aria-live on the Entity-index "X of N" filter count, so screen-reader
    users get search-as-you-type result feedback. V2.
  - [tests] Lock the empty-query browse newest-first ordering (created_at DESC). V2.
- **Files**: none (scout) — ledger only.
- **Verification**: n/a (no code change); tree green at start (192 tests, viewer ✓).
- **Commit**: dc0ca5b (ledger only)
- **Saturation**: functionality nearing saturation (clean V≥3 wins exhausted —
  future functionality turns likely need the GENERATIVE SWITCH or an opt-in knob);
  no flag forced. Other dims unchanged.

### Iteration 55 · correctness/robustness · mode=exploit (fresh survey)
- **Change**: embedding failures are now logged to stderr (matching the existing
  `[tense]` convention in server.ts) at both swallow sites — `remember` (Fact
  stored without a vector) and `recall` (falls back to keyword). Previously both
  were silent `catch {}`, so a misconfigured/down embedding provider made semantic
  recall SILENTLY degrade with zero operational signal. stderr only — never
  stdout, which is the MCP protocol channel.
- **Net-positive**: improves correctness/robustness (observability — a silent
  core-feature degradation becomes visible). Protects ingestion/recall behavior
  (still best-effort; Fact still stored, recall still falls back to keyword) and
  the MCP stdout protocol. V=3 C=4 S=4. Synergy with iter-50 retry: only
  retry-exhausted (persistent) failures log, so transient blips don't spam.
- **Fresh survey**: checked migrations (indexes reasonable: entities unique+trgm,
  facts current/subject-predicate/source, fact_sources), the logging convention
  (server.ts uses `console.error("[tense] …")`), resolver/apply (mature, tested).
  The silent embedding swallow was the clearest robustness gap. Saturation cleared.
- **Supersedes backlog #3** (iter-54 "embedding-dim guard"): surfacing ALL embed
  failures is simpler + broader than a dim-specific probe (dim mismatch is just one
  cause; also covers bad key, provider-down, retry-exhausted rate limits).
- **Files**: src/pipeline.ts + src/retrieval/recall.ts (catch (err) + stderr warn),
  test/pipeline.integration.test.ts (+1: ingests-but-warns on embed failure, via a
  console.error spy + a throwing-embed provider).
- **Verification**: `npm run typecheck` ✓ · `npm run lint` ✓ · `npm run build` ✓ ·
  `npm test` ✓ (40 files / 193 tests, +1; no stray warnings — spy-mocked). Viewer
  gate not run (no viewer change). → pass.
- **Commit**: 79a9c10
- **Saturation**: ALL flags cleared (fresh survey, iter 55) — all already 0;
  correctness/robustness active (V=3). Codebase remains mature/clean.

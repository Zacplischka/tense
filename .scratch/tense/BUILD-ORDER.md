# Tense — Build Order & Verification Playbook

How to work through the 16 issues, and exactly how Claude Code verifies each stage **against real services** (real Postgres, real stdio MCP, real OpenRouter, real browser) — distinct from the unit/integration tests each issue already defines.

## Standing verification harness (set up once)

Claude can drive all of these from Bash (+ the browser tools for the viewer):

- **Real Postgres** — `docker run -d --name tense-pg -e POSTGRES_PASSWORD=tense -p 5432:5432 pgvector/pgvector:pg16` (ships `pgvector`; `pg_trgm` is in contrib). Claude asserts state with `psql`.
- **Real stdio MCP** — call the server over stdio with the MCP Inspector CLI: `npx @modelcontextprotocol/inspector --cli -- node dist/server.js` → `tools/list`, `tools/call`. This is a *real* client↔server handshake, not a mock.
- **Real OpenRouter** — needs `OPENROUTER_API_KEY` in env (+ `TENSE_EXTRACTION_MODEL`, `TENSE_EMBEDDING_MODEL`). Claude runs a small script that actually hits the API.
- **Real viewer** — `next dev`, then Claude uses the Chrome browser-automation tools to navigate to `localhost:3000`, screenshot, read the DOM, and capture the grey-out as a GIF.

Stages needing live credentials/services are flagged 🔑 (OpenRouter), 🐘 (Postgres), 🌐 (browser).

## Build order

**Recommended linear "grab-next" for a single agent** (gets the thesis demo working as early as step 3):

`01 → 03 → 08` → `02 → 05 → 06 → 07` → `09 → 10` → `13 → 12` → `15 → 14 → 16`

**Parallel waves** (if running multiple agents; HITL items authored by the human in parallel from day one):

| Wave | Issues | Notes |
|---|---|---|
| 0 | **01** | foundation; nothing starts until schema + MCP skeleton exist |
| 1 | **02**, **03** | both depend only on 01 and run in parallel. *HITL 04, 11 start now, in parallel.* |
| 2 | **08** (after 03), **05** (after 02+04) | viewer demos the thesis on seeded data while extraction comes online |
| 3 | **06** (after 05) | resolution |
| 4 | **07** (after 03,05,06) | convergence — real `remember` pipeline |
| 5 | **09**, **10** (after 07) | recall + history |
| 6 | **13** (after 09,11), **12** (after 09,11), **15** (after 09) | eval, contradiction, narrative |
| 7 | **14** (after 13), **16** (after 08,09,13) | DSPy, demo recording |

The point of the order: **01 → 03 → 08 reaches the flagship grey-out with no LLM in the path**, so the riskiest visual is proven before any extraction quality work.

## Per-stage real-connection verification

### 01 — Skeleton + DB bootstrap 🐘
- `psql -c "\dx"` shows `vector` + `pg_trgm`; `\d facts` shows `valid_at/invalid_at/created_at/expired_at`; `\di` shows the partial index `WHERE expired_at IS NULL`.
- Launch server; via MCP Inspector CLI: `tools/list` returns `remember`/`recall`; `tools/call remember {text}` then `tools/call recall {query}` returns the stubbed (supersession-shaped) Facts.
- `psql` confirms rows in `entities`/`facts`/`sources` with the Fact→Source FK populated.
- **Pass:** extensions + schema + index correct; real stdio round-trip returns data; store integration suite green.

### 02 — Provider client + embeddings + config 🔑🐘
- Run a script calling `provider.complete()` and `provider.embed()` against the configured model → real completion text + a vector of the expected dimension.
- Set `TENSE_EXTRACTION_MODEL` to two different ids; assert each request targets the set model (capture/log).
- `psql` shows a populated pgvector column after embedding a Fact.
- **Pass:** real completion + real embedding returned; model-swap honored end-to-end.

### 03 — Supersession resolver 🐘
- Run the exhaustive unit suite (pure, deterministic) — green.
- Drive two Facts on `reports-to` through the resolver into real PG; `psql` asserts: old Fact `invalid_at = new.valid_at` (valid-time close) **and** `expired_at` set to the supersession wall-clock (transaction-time close), new Fact `expired_at IS NULL`, **both rows still present** (expire-not-delete). Keep the two times distinct — never set `expired_at = new.valid_at` (that conflates valid and transaction time, breaking the ADR-0002 point-in-time formula).
- Seed the degenerate cases and assert via `psql`: null `valid_at` → transaction-time fallback; tied `valid_at` → transaction-time tiebreak; out-of-order → new Fact born with `expired_at` set.
- Atomicity: force the insert to fail → confirm the expire rolled back (no torn state).
- **Pass:** units green; DB shows correct intervals + retention; degenerate policy holds; supersession is atomic.

### 08 — Live viewer (grey-out) 🌐🐘
- `next dev` against real PG; browser-navigate to `localhost:3000`; screenshot the seeded graph.
- Drive a supersession (resolver/`remember`), wait one poll, screenshot again; `read_page` to assert the old edge's class is dashed/greyed and the new edge is solid. Capture a GIF of the transition.
- Fixture where valid-time and transaction-time disagree → confirm the *correct* edge is dashed (viewer uses `expired_at IS NULL`).
- **Pass:** grey-out visually observed in a real browser; Current semantics match the store.

### 04 — Smoke gold set (HITL)
- Claude verifies the fixtures load and are well-formed, and that coverage includes ≥1 supersession scenario and ≥1 null-`valid_at` scenario.
- **Pass:** fixtures parse; required cases present. (Human authors the content.)

### 05 — Extraction 🔑
- Run real extraction over each smoke scenario; diff extracted Entities/Facts vs expected; report match rate + `valid_at` accuracy.
- Bad-output path: stub the provider to return malformed JSON → assert `remember` returns a clean error and the MCP server stays alive (`tools/list` still responds).
- **Pass:** smoke scenarios meet threshold; bad-output handled gracefully; human quality sign-off recorded.

### 06 — Entity resolution 🐘
- Unit suite (exact/fuzzy/guard/no-false-merge) green.
- Against real PG with `pg_trgm`: insert "Zach", resolve "Zachary" → same `entity_id` (`psql` shows one Entity); resolve "Zara" → a new Entity. Run the demo name-pair stability test.
- **Pass:** variants merge, distinct entities stay separate, demo subject stable.

### 07 — Wire `remember` pipeline 🔑🐘
- Full real path over stdio MCP + real PG + real OpenRouter: `remember` "Zach reports to Alice", then `remember` "Zach now reports to Bob". `psql` asserts: Alice Fact closed, Bob Fact Current, exactly one Zach Entity.
- MCP integration test (provider replayed) green; extraction failure surfaces as a `remember` error without corrupting the graph.
- **Pass:** end-to-end org-change behavior confirmed against real services.

### 09 — Point-in-time recall 🔑🐘
- Via MCP Inspector: `recall {"query":"who does Zach report to"}` → **Bob**, with Source citation + validity interval in the payload. `recall {"query":..., "as_of":"<before Bob>"}` → **Alice**.
- Inspect the raw MCP response to confirm citation + interval fields are present.
- Unit tests (current-only default, `as_of`, RRF ordering with a fixed oracle) green.
- **Pass:** current vs `as_of` correct via real MCP call; provenance surfaced.

### 10 — `history` tool 🔑🐘
- Via MCP Inspector: `history {"entity":"Zach","predicate":"reports-to"}` → `[Alice (closed, interval), Bob (Current)]` in the defined order, each with Source.
- **Pass:** chain correct and ordered.

### 11 — Full gold eval set (HITL)
- Claude verifies well-formedness + coverage of null / tied / out-of-order / **still-true (must-not-supersede)** cases, and that each QA item has a single unambiguous gold answer + source.
- **Pass:** structure + coverage validated. (Human authors the content.)

### 12 — LLM-judged contradiction 🔑🐘
- Real path: `remember` "Zach works at Acme", then "Zach left Acme"; `psql` asserts the `works-at` Fact is superseded.
- Run the metric gate against the full gold set: precision/recall + false-supersession rate ≥ threshold.
- Confirm it calls slice-03's direction rule (one rule, not two).
- **Pass:** cross-Predicate case works; metrics meet threshold.

### 13 — Eval harness + fair baseline 🔑🐘
- Run the harness against the full gold set → prints temporal-QA accuracy (Tense vs baseline) **on `as_of` questions**, supersession P/R incl. false-supersession, triple-F1, `valid_at` accuracy.
- Inspect the baseline config: same Sources, same embedding model, recency tiebreak allowed.
- **Pass:** metrics produced; Tense beats the *fair* baseline on the `as_of` set; numbers recorded for the headline chart.

### 14 — DSPy offline pipeline 🔑
- Run the offline pipeline → emits a lift report (baseline F1 → optimized F1) + static prompt assets. Confirm the TS Extraction module loads the static assets; re-run slice-13 eval to confirm the reported number.
- **Pass:** lift report produced, winning prompt set shipped (no-improvement is an acceptable outcome), extraction consumes static assets.

### 15 — Repo polish + architecture narrative 🔑🐘🌐
- "Stranger test": from a clean checkout, follow the README onboarding — one-command DB bootstrap + the MCP client-config snippet → connect from the MCP Inspector and call `recall` successfully.
- Verify README links resolve to `CONTEXT.md` + ADRs and the "why no graph DB" section is present.
- **Pass:** a fresh environment reaches a working `recall` purely from the docs.

### 16 — Demo seed + recording (HITL) 🌐🐘
- Dry-run before the human records: run the seed with **pinned/replayed extraction** (no live LLM at record time); run the golden single-entity assertion (subject resolves to one Entity); drive the viewer via browser automation and capture the 3 beats (grow → grey-out → current-vs-`as_of` + baseline contrast) as a GIF.
- **Pass:** the dry-run reproduces all three beats deterministically; only resolver + viewer are live on camera.

# Manual ingestion seam

Status: ready-for-agent
Type: AFK

## Parent

Design record: `docs/adr/0004-viewer-hosts-ingestion-write-path.md`, `CONTEXT.md`.

## What to build

Give the viewer a write path so a person can drop text in and watch the graph react — using the same endpoint the future session hook will reuse. A new `POST /api/remember` route in the viewer accepts raw text (and an optional Source label), runs it through the existing `remember()` pipeline, and returns the resulting summary of Facts created and superseded. The viewer gains a textarea + "Remember" control with three visible states: extracting…, result (e.g. "3 Facts created, 1 superseded" / "no Facts found"), and error. The existing 1s poll renders the graph change — no new render path needed.

The pipeline wiring currently done inline at the MCP entry point (store, extractor, resolver, registry, provider, contradiction enabled) must be extracted into a single shared `createRememberDeps(pool)` factory so the MCP server and the viewer route share one source of truth. The viewer reuses its existing single Postgres pool and reads `OPENROUTER_API_KEY` from its environment for extraction.

This slice also corrects the now-stale "read-only viewer" claim in the README and PRD.

## Acceptance criteria

- [ ] `createRememberDeps(pool)` factory exists and is the sole wiring used by both the MCP server entry point and the viewer route (contradiction path on; provider configured from env).
- [ ] `POST /api/remember` accepts `{ text, source? }`, calls `remember()`, and returns the Facts created and superseded; missing/empty `text` is a 400.
- [ ] Extraction/pipeline failure returns a non-200 with a readable message and leaves the graph untouched (no orphan Source) — consistent with the pipeline's extract-before-write guarantee.
- [ ] The viewer shows a textarea + "Remember" control with distinct extracting / result / error states; on success the polled graph reflects the new Facts within one poll interval.
- [ ] The viewer's dependency on the root `dist/` build is handled/documented, and `zod` is resolvable from the route.
- [ ] README and PRD scope wording updated to reflect the viewer's local ingestion endpoint.

## Blocked by

None - can start immediately.

## Comments

✅ **Completed.** `createRememberDeps(pool)` factory (`src/remember-deps.ts`) is now
the sole wiring, used by both `src/server.ts` and the viewer's `POST /api/remember`
(`viewer/app/api/remember/route.ts`). The route validates input (400 on empty
`text`), returns the `RememberSummary` (created/superseded/reaffirmed), and on
extraction failure returns 500 with the graph untouched (extract-before-write).
Viewer gained a textarea + "Remember" button with extracting / result / error
states. `zod` added to the viewer; the route loads the project-root `.env` for
`OPENROUTER_API_KEY` (existing env vars win — verified `loadEnvFile` doesn't
override). Root + viewer typecheck clean; `next build` clean; **live smoke test
passed** (create → reaffirm → 400 → graph). README + PRD scope updated to
"read-mostly".

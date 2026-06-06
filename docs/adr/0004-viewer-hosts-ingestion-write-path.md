# Viewer hosts the ingestion write-path

The viewer was deliberately **read-only** (README, PRD): it read Postgres directly and only *rendered* the graph. Adding "drop text and watch the graph grow" — and, behind it, a Claude Code SessionEnd hook that feeds session summaries into the graph — requires a write path into the `remember()` pipeline. We put that write path **in the viewer**: a single `POST /api/remember` route in the Next.js app that imports `remember()` from the compiled `dist/` and constructs its dependencies through a shared `createRememberDeps(pool)` factory (the same wiring `server.ts` uses for MCP, `enableContradiction: true`).

The driving reason is process count. The viewer is the one long-running HTTP process whose entire purpose is "keep it open and watch the graph." The `remember` pipeline's runtime footprint is tiny — `pg` (already a viewer dependency) and `zod`, with OpenRouter reached via global `fetch`, no SDK — so co-locating ingestion there is low-friction, and both consumers (the manual textarea and the hook's `curl`) hit the same endpoint.

## Considered options

- **Separate backend HTTP service** (the pipeline stays in `src/`, viewer proxies or the hook hits it directly). Cleaner layering and keeps the viewer read-only, but adds a *second* long-running process to run during the demo and a new entry point alongside the MCP server.
- **MCP-only ingest** (the hook drives `remember` via an agentic `claude -p` with the Tense MCP attached). Rejected for the hook because it is non-deterministic and bypasses the shared HTTP seam; and it does nothing for the manual textarea, which can't speak MCP from the browser.

## Consequences

- The viewer build now depends on the root `dist/` being built first (`pnpm build`), and `zod` is added to the viewer.
- The "read-only viewer" scope statement in the README/PRD no longer holds; the write route is isolated and the scope note should be updated to say the viewer is read-mostly with a single local ingestion endpoint.
- Single-user/local only: the endpoint is unauthenticated and bound to localhost, consistent with the project's single-tenant scope.

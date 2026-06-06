# Plugin packaging: install once, brain feeds and serves itself

Status: ready-for-human
Type: HITL

## Parent

Design record: `docs/adr/0004-viewer-hosts-ingestion-write-path.md`, `docs/adr/0005-reaffirmation-facts-cite-multiple-sources.md`.

## What to build

Package the whole capability as an installable Claude Code plugin, so installing it gives Claude a living temporal memory it both feeds and can query. The plugin bundles: the recursion-safe SessionEnd hook (slice 04); the Tense MCP server configuration (`remember`/`recall`/`history`) so Claude can use its growing memory mid-session; and a `/tense` slash command that brings the stack up idempotently — start Postgres, start the viewer if it isn't running, open `:3000`, and ensure `OPENROUTER_API_KEY` is present for extraction.

The deliverable is verified end-to-end with a human: install into a clean Claude Code, run `/tense`, have a real session, end it, and watch new Entities/Facts grow in the viewer — with recursion still impossible. Slice 02 (growth-highlight) is strongly recommended to land first so the first install already feels alive.

## Acceptance criteria

- [ ] A plugin manifest bundles the SessionEnd hook, the Tense MCP server config, and the `/tense` launcher command.
- [ ] `/tense` is idempotent: running it with the stack already up starts no duplicates, and it surfaces a clear message if Docker or the API key is missing.
- [ ] After install, `recall`/`remember`/`history` are available to Claude via the bundled MCP server.
- [ ] Full-loop verification with a human: install → `/tense` → real session → session end → new Facts visible in the viewer, with zero recursive hook executions.
- [ ] Plugin README documents prerequisites (Docker, the Tense repo/`dist`, `OPENROUTER_API_KEY`) and the single-user/local scope.

## Blocked by

- `.scratch/living-memory-plugin/issues/04-recursion-safe-session-hook.md`
- Recommended (not hard): `.scratch/living-memory-plugin/issues/02-growth-legible-viewer.md`

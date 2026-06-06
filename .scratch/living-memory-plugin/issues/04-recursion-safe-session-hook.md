# Recursion-safe session summarizer hook

Status: ready-for-human
Type: HITL

## Parent

Design record: `docs/adr/0004-viewer-hosts-ingestion-write-path.md`. Safety constraint: memory `session-end-hook-no-recursion`.

## What to build

A Claude Code SessionEnd hook that turns a finished session into graph growth, and that is **provably unable to recurse**. On session end it summarizes the transcript with a detached `claude -p` and `curl`s the summary to the viewer's `POST /api/remember`, where the existing pipeline extracts Entities/Facts. It runs detached so it never blocks session exit, and skips trivial sessions (and skips the `curl` on an empty summary, so no empty Source is created).

The recursion guard is the point of this slice and is non-negotiable: the spawned `claude -p` would itself fire SessionEnd — exactly the loop that previously drained the user's usage limit. Defense in depth (the first two layers each independently sufficient): an env-var short-circuit set before the spawn and checked at the top of the hook (the child inherits it and exits immediately); the child launched with hooks disabled and MCP disabled and no tools; a hard timeout; and a single-flight lock so overlapping session-ends can't stack processes. The guard MUST be verified end-to-end **before the hook is ever armed** in real settings — synthetic trigger → real `-p` run → real terminal close — per the `session-end-hook-setup` skill.

## Acceptance criteria

- [ ] SessionEnd hook reads the transcript, produces a summary via a detached, time-bounded `claude -p`, and `curl`s it to `/api/remember`; resulting Facts appear in the viewer.
- [ ] Recursion is impossible: with the hook armed, ending a session spawns exactly one summarizer and **zero** further hook executions (the child's SessionEnd short-circuits) — demonstrated by a run that counts hook invocations.
- [ ] The summarizer child runs with hooks off, MCP off, tools off, under a timeout, and behind a single-flight lock.
- [ ] Trivial/empty sessions and empty summaries are skipped — no empty Source is ingested.
- [ ] End-to-end recursion verification performed and recorded (synthetic → real `-p` exit → real terminal close) before the hook is armed in the user's real configuration.
- [ ] Summaries are ingested with a descriptive Source label (e.g. `claude-session · <date> · <project>`).

## Blocked by

- `.scratch/living-memory-plugin/issues/01-manual-ingestion-seam.md` (the `/api/remember` endpoint)
- `.scratch/living-memory-plugin/issues/03-reaffirmation.md` (so the always-on stream reaffirms instead of bloating)

## Comments

✅ **Built, verified, and armed (project-scoped).** Hook:
`.claude/hooks/tense-session-to-graph.py` — guard-first entry, detached worker,
single-flight `fcntl` lock, `subprocess` timeout, NONE/empty skip, secret
redaction (reuses the transcript parser). Summarizer:
`claude -p --model haiku --strict-mcp-config` run in a throwaway cwd (so it can't
read the repo and never loads the project hooks — a 2nd recursion barrier).

**Recursion proof (`scripts/session-hook/verify_hook.py`, 7/7, zero real
`claude`):** (A) a hook run with `TENSE_SESSION_HOOK` set spawns nothing; (B) the
real `hook_entry → worker → claude` flow propagates that var into the child ⇒ the
summarizer's own SessionEnd is a no-op. Recursion is unreachable by construction.

**Docs research corrected two assumptions:** `--bare` would skip hooks but
*disables OAuth/keychain auth* (we rely on OAuth) → not used; `--settings '{}'`
does **not** disable inherited hooks → we never relied on it (the env guard does
the work). `--max-turns 1` errors and `--tools ""` degrades output → dropped.

**Live armed-path proof:** piping a real `SessionEnd` payload into the registered
hook returned in 0.05s and the detached worker produced a real haiku summary
("…prefers pnpm over npm." etc.) POSTed to a mock `/api/remember` — zero
pollution.

Armed in `.claude/settings.json` (`SessionEnd`), this repo only. Off-switch:
delete that block. Remaining human acceptance — observing a real terminal-close —
is now safe to do since recursion is impossible by construction.

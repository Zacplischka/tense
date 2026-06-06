# Repo polish + architecture narrative + onboarding

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/tense/PRD.md`

## What to build

The portfolio narrative layer — the part a reviewer reads first and the reason the architecture looks deliberate rather than naive. Covers the otherwise-homeless stories 22 (clean repo, glossary, ADRs surfaced) and 23 ("why no graph DB / no Graphiti"), plus developer onboarding (story 12).

## Acceptance criteria

- [ ] Top-level README: the thesis, the tagline, a quickstart, and links to `CONTEXT.md` (glossary) and ADRs 0001–0003.
- [ ] An explicit **"Why Postgres, not a graph DB / not Graphiti"** section (story 23), drawn from ADR 0001.
- [ ] **Onboarding/install:** one-command DB bootstrap + an MCP client-config example for connecting Tense to Claude Code/Cursor over stdio (story 12).
- [ ] Repo-cleanliness pass (consistent structure, dead code removed, env documented).

## Blocked by

- `09-point-in-time-recall`

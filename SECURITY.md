# Security posture

Tense is a single-tenant, local-first MCP server: one trusted writer, one Postgres,
stdio transport. It is not built to face the public internet, and that scope is
deliberate (see [README · Scope](./README.md#scope) and
[ADR 0007](./docs/adr/0007-ingest-assumes-a-single-writer.md)). This document states
the trust boundaries it *does* defend, with the code that backs each claim, so a
reviewer can check the posture rather than take it on faith.

## Trust boundaries

Tense crosses three boundaries, and each is handled at the seam it crosses:

| Boundary | Input | How it's contained |
|---|---|---|
| **Untrusted Source text → graph** | Arbitrary prose handed to `remember` / `preview` | Never executed or interpolated into SQL. It is sent to the LLM **extractor** as content, and only the *structured* result (typed `subject`/`predicate`/`object` triples) reaches the store. Extraction failures degrade to "no Facts," never a write of attacker-shaped SQL. |
| **Agent/MCP tool inputs → SQL** | `query`, `as_of`, `predicate`, `limit`, `since`, `min_reinforced`, … | Validated at the MCP edge with [zod](./src/mcp/server.ts) (typed, bounded), then passed to Postgres **only** as `$1…$N` bind parameters — never string-concatenated. |
| **Operator → secrets** | `OPENROUTER_API_KEY`, `TENSE_DATABASE_URL` | Read from the environment / a git-ignored `.env` only. Never logged, never returned in a tool result, never committed. |

## SQL injection

Every value that originates outside the process reaches Postgres as a bind
parameter (`$N`), not as interpolated text. The only values interpolated into a
query string are **server-controlled and closed-set**:

- column lists and `SELECT` bodies are module constants (`FACT_COLUMNS`,
  `RECALL_SELECT` in [`src/db/store.ts`](./src/db/store.ts));
- `ORDER BY` is chosen from a fixed pair of literals (`f.created_at DESC` /
  `f.valid_at DESC`), never from input;
- `LIMIT` is `clampLimit(n)` — `Math.min(Math.max(Math.floor(n) || 1, 1), 200)` —
  so an agent can neither inject through it nor request an unbounded scan; it is an
  integer in `[1, 200]` by construction.

User-supplied `predicate`, `as_of`, `since`, and `min_reinforced` are all bound
positionally (e.g. `f.predicate = $${params.push(predicate)}`), so a Predicate
named `'; DROP TABLE facts; --` is matched as a literal string and finds nothing.

## Secret handling

- `.env`, `.env.local` are git-ignored; only [`.env.example`](./.env.example)
  (placeholders, no values) is committed.
- Ingestion **fails fast** if `OPENROUTER_API_KEY` is unset, with a message that
  points at `.env.example` rather than silently sending unauthenticated requests
  or half-completing a write ([`src/provider/openrouter.ts`](./src/provider/openrouter.ts)).
- No code path logs the key or echoes it into a tool result; `config` reads it
  into memory and hands it to the provider client, nowhere else
  ([`src/config.ts`](./src/config.ts)).
- The keyless paths (`pnpm eval:offline`, `pnpm bench`, `pnpm seed:demo`,
  `pnpm demo:agent`) need no secret at all, so a reviewer can exercise the engine
  without provisioning one.

## Deliberately out of scope

These are **not** bugs; they are the boundary of a single-tenant portfolio system,
and pretending otherwise would be the overclaim:

- **No authn/z or multi-tenancy.** The MCP server trusts its single connected
  client; there is no per-caller identity, row-level isolation, or rate limiting.
  Ingest assumes one writer ([ADR 0007](./docs/adr/0007-ingest-assumes-a-single-writer.md)).
- **No network transport hardening.** Transport is stdio to a local client, not an
  exposed HTTP surface; there is no TLS termination, CORS, or session layer to
  harden because there is no remote listener.
- **LLM extraction is best-effort, not adversary-proof.** A crafted Source could
  steer what Facts get extracted (a prompt-injection surface inherent to any
  LLM-in-the-loop ingest). The containment is structural, not behavioral: the
  model's output is constrained to typed triples that can only ever become Facts,
  never code or SQL, and `preview` lets an operator dry-run an ingest and see
  exactly what *would* be written before committing it.

## Reporting

This is a personal portfolio project, not a deployed service. If you spot a
security issue, please open an issue or email the address in the commit history.
There is no production deployment at risk; the value of a report here is improving
the artifact.

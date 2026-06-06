# Ingest assumes a single writer (concurrency model)

The `remember` pipeline resolves a Fact in three steps that are NOT one atomic
unit: it reads the current Facts for the subject (`currentFactsFor`), decides
reaffirm-vs-supersede in pure code (`decideFact` → `resolveSupersession`), then
writes (`supersedeAndInsert`, its own transaction). The read and the write use
separate pool connections / transactions, and there is no database-level guard on
"at most one Current Fact per (subject, single-valued predicate)" — the partial
index `idx_facts_current` is deliberately **non-unique**.

So under genuinely concurrent ingest, two `remember`s for the same subject and the
same single-valued Predicate can each read "no Current Fact", each decide "create,
nothing to supersede", and both insert — leaving **two** Current Facts on a
single-valued Predicate, violating the cardinality invariant the whole supersession
model rests on (ADR 0002).

**Decision: assume a single writer; do not add concurrency control yet.** Today's
entry points are serial: the stdio MCP server has one client and processes calls in
order, and the viewer is a single-user dev tool. The race is real but not triggered.
The scenario to watch is the always-on ingestion stream (the Claude Code session
hook, ADR 0005): if it can fire overlapping `remember`s — or overlap with a manual
one — concurrency becomes real and this assumption must be revisited.

## Considered options (and why not now)

- **Blanket `UNIQUE … WHERE expired_at IS NULL` on (subject_id, predicate)** —
  WRONG. Cardinality is an application concept (the `PredicateRegistry`): multi-valued
  Predicates (`knows`, `contributed-to`) legitimately have many Current Facts for a
  subject. A schema-level unique index can't see single- vs multi-valued, so it would
  forbid valid multi-valued state.
- **Make read+decide+write atomic** (advisory lock per subject, or run the whole
  per-Fact step in one transaction with `pg_advisory_xact_lock(hashtext(subject_id))`).
  This is the right fix when concurrency is real, but it is invasive: the store
  currently owns the *mechanics* and the atomic boundary while holding **no
  supersession policy** (that lives in the resolver, ADR 0001/0002 separation). An
  atomic read+decide+write either couples the store to the resolver (breaking that
  separation) or has the pipeline manage a transaction across store calls (exposing
  client-passing). Either is a deliberate architectural change deserving its own
  iteration — not worth doing for a race that cannot occur under current usage.
- **Serializable isolation for the ingest transaction** — would turn the race into a
  serialization error to retry, but only if the read is *inside* the write
  transaction (it isn't today), so it needs the same restructuring.

## Consequences

- Correct under the current single-writer entry points; documented so a future
  always-on / multi-client ingestion path knows to add per-subject serialization
  first.
- The fix, when needed, is a per-subject advisory lock spanning read→write (or
  moving `currentFactsFor` into the write transaction) — preserving the store/policy
  separation by having the pipeline hold the lock, not the store.
- Tracked in `.codeloop/ledger.md` backlog (found iter 29).

# Read-only introspection and dry-run preview surface

The MCP server began with three tools — `remember`, `recall`, `history` — enough to
write and query memory but not to *understand* it. An agent (or the viewer) had no
way to ask "what is in my memory, and where did it come from?" without recalling
Facts, and no way to see what ingesting a Source *would* do before committing it.
As Tense matured these gaps mattered: an agent should be able to audit its own
graph, and avoid polluting it with a bad extraction.

We added a read-only surface around the existing write/query core:

- **Introspection trio** — `stats` (aggregate counts: Entities, Sources, Facts
  split Current vs superseded, per-Predicate), `entities` (browse nodes by
  Current-Fact degree, name-substring filter), `sources` (audit ingested Sources:
  label, preview, ingest time, Facts-cited count). Each maps to a first-class
  `CONTEXT.md` term and answers a distinct "what's in my memory?" question.
- **`preview`** — a dry-run of `remember`: report the Facts it *would* create /
  supersede / reaffirm and how each name resolves, **writing nothing**.
- **Tool annotations** — the read tools declare `readOnlyHint: true` (a client may
  auto-approve them); `remember` declares `readOnlyHint: false` and crucially
  `destructiveHint: false`, making the system's never-deletes invariant
  (supersession retains, never removes) machine-readable.

The load-bearing decision is how `preview` stays honest. It reuses the *exact*
pieces `remember` uses — the extractor, read-only `resolver.resolve`, and the
shared per-Fact `decideFact` (reaffirm vs write-with-supersession, wrapping the
pure `resolveSupersession`). Because both call one function, **preview predicts
remember by construction**, not by parallel code that drifts; a test asserts the
graph is unchanged after a preview *and* that the prediction matches what
`remember` then produces.

## Considered options

- **Refactor `remember` into `plan()` + `apply()`** so `remember = apply(plan())`
  and `preview = plan()` — **rejected**. `remember` is *incremental*: each Fact's
  supersession decision is made against the live graph *after* earlier Facts in the
  same Source are written (it re-queries `currentFactsFor`). An up-front read-only
  plan would not see those intra-batch effects, so a multi-Fact Source whose Facts
  supersede each other would be planned (and applied) wrong. Keeping `remember`
  incremental and sharing only the *pure* decision (`decideFact`) gets the
  consistency benefit without the regression.
- **Duplicate the preview orchestration** — rejected; the two paths would drift and
  preview would quietly stop predicting remember.
- **More tools vs. fewer** — six read/write tools plus `preview` is still lean, and
  each is distinct (aggregate vs node-browse vs source-audit vs query vs chain vs
  dry-run), so the surface stays legible to a calling model.

## Consequences

- The MCP surface is `remember` · `preview` · `recall` (with `as_of` / `predicate`
  / `limit` / `min_reinforced`) · `history` · `stats` · `entities` · `sources`.
- `decideFact` (`src/supersession/decide.ts`) is the single home of the per-Fact
  reaffirm/supersede decision; **do not** reintroduce that logic inline, and **do
  not** convert `remember` to an up-front plan (see the rejected option) — both
  would break the preview↔remember equivalence or intra-batch correctness.
- `preview` simulates against the graph's *current* state, so intra-batch
  supersession within a single multi-Fact Source isn't reflected — accurate for the
  common case (previewing a Source against existing memory); documented in
  `src/preview.ts`.
- Read-only signals already tracked are now surfaced: `reinforcedBy` (provenance
  strength) on recalled Facts, and `entitiesResolved` (new/exact/fuzzy) on
  `remember`/`preview`, so a fuzzy mis-merge is visible rather than silent.

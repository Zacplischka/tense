# Tense — case study

*A 2-minute read of the project behind the [reference README](../README.md): the
problem, the bet I made, the decision I had to defend, and how I proved it. Every
claim below links to the code, eval, or ADR that backs it — nothing here is
assertion-only.*

---

## The problem: vector memory can't tell *current* from *was-true*

Give an agent a vector store as memory and it indexes "Zach reports to Alice" and
"Zach reports to Bob" with near-identical embeddings. It returns both, with no
principled way to know the second **superseded** the first, when that happened, or
who Zach reported to *last quarter*. Ask "who does Zach report to as of March
2024?" and a recency-sorted store hands the agent the most-recent value — Bob —
and tells it nothing is wrong. The agent acts on a confidently-wrong fact.

That failure isn't a tuning problem; it's structural. A store with one time axis
cannot answer a two-axis question.

## The bet: model memory as a bi-temporal graph

Tense stores knowledge as Facts (`subject → predicate → object`) on two
independent time axes — **valid time** (when a fact was true in the world) and
**transaction time** (when the system learned it). A new fact on a single-valued
predicate doesn't overwrite the old one; it **supersedes** it — closes it and
keeps it queryable. So `recall(as_of=…)` filters the valid-time axis and returns
who was Current *then*, while `history` / `changes` walk the transaction-time
axis. The two axes, and why conflating them is the project's signature mistake,
are spelled out in [CONTEXT.md](../CONTEXT.md) and drawn as a
[plane](./media/bitemporal.svg).

## The decision I had to defend: build the engine, on one Postgres

The obvious shortcut was [Graphiti](https://github.com/getzep/graphiti) plus a
graph database. I rejected both, on purpose:

- **One Postgres, no graph DB.** At demo scale, recursive CTEs cover any traversal,
  so a second store earns nothing and adds an operational seam a reviewer will
  attack first. One Postgres holds the relational graph, the vectors (`pgvector`),
  and fuzzy entity resolution (`pg_trgm`) — [ADR 0001](./adr/0001-hand-built-temporal-graph-on-postgres.md).
- **Hand-built supersession, not Graphiti.** Delegating the differentiator to a
  library weakens the "I built it" story and forces a Python sidecar into a
  TypeScript stack. Tense keeps Graphiti's best idea (LLM-nominate →
  temporal-gate a contradiction) and **adds** a deterministic cardinality path on
  top, so the filmed demo is reproducible — [ADR 0002](./adr/0002-bitemporal-facts-cardinality-supersession.md).

The non-obvious calls are all written down as [ADRs](./adr/README.md), with the
alternatives weighed and rejected — including why recall is *filter-then-fuse* with
RRF rather than a tuned weighted blend ([ADR 0008](./adr/0008-hybrid-recall-filter-then-fuse.md)).

## The proof: a fair baseline, beaten where it structurally must lose

The headline isn't "memory works." It's a measured win against the *strongest*
naive baseline, on the exact questions that expose the gap:

| Temporal-QA (10-scenario gold set) | Tense | Fair vector baseline |
|---|---|---|
| **Point-in-time (5 questions whose answer changed)** | **100%** | **0%** |
| All questions (11) | 100% | 55% |

The baseline isn't a strawman: its candidate pool **includes the superseded fact**,
so the right answer is in front of it — it just has no bi-temporal model, so its
recency tiebreak ranks the most-recent value first and is wrong for any past
`as_of`. That its miss is an honest ranking choice, not blindness, is
[regression-tested](../test/eval-baseline-fairness.integration.test.ts). The win
reproduces with **no API key and no spend** via `pnpm eval:offline`
(byte-identical every run), and a [drift-guard test](../test/eval-results-snapshot.integration.test.ts)
fails if the committed [results](../eval/RESULTS.md) or
[accuracy chart](./media/accuracy.svg) fall out of sync with a live run.

Accuracy is only half of agent-hot-path memory; latency is the other half. The
real read path — temporal filter in SQL → pgvector cosine + full-text → RRF —
recalls over a 734-Current-Fact graph at **~4.5 ms p50 / ~7 ms p99**
(`pnpm bench`), comfortably inside a tool-call budget.

## What it demonstrates

| Competency | Evidence in this repo |
|---|---|
| Systems design | One write path, one read path, [one Postgres](../README.md#architecture); 8 [ADRs](./adr/README.md) with rejected alternatives |
| Evaluation rigor | Adversarial [gold set](../eval/gold.ts), a *fair* baseline, [fairness](../test/eval-baseline-fairness.integration.test.ts) + [drift](../test/eval-results-snapshot.integration.test.ts) guards, keyless reproduction |
| AI engineering | LLM extraction with a [typed prompt seam](../src/extraction/prompts.ts) and a deterministic stub double; DSPy as an [offline optimizer](./adr/0003-dspy-offline-prompt-optimizer.md), never a runtime dep |
| Production sense | Best-effort embedding never fails a write; MCP `isError` contract; [partial-index](../README.md#how-it-works) Current; staleness banner in the viewer |
| Communication | This case study, the reference README, and a live [viewer](./media/viewer.png) that animates supersession |

## Honest limits (and what's next)

Deliberately out of scope today: source-trust ranking (two Sources disagreeing at
the *same* time — a different problem from temporal supersession), multi-tenancy /
auth, and a dragged-through timeline animation (the viewer ships point-in-time as a
date picker). The gold set is small but adversarial by design; the highest-value
next step is expanding it to ~30 scenarios with harder extraction cases — the point
at which the [DSPy optimizer](../dspy/README.md), already wired and currently
reporting "no lift to capture," would start to earn its keep. See the
[PRD](../.scratch/tense/PRD.md) and [scope](../README.md#scope).

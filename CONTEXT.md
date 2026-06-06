# Tense

**Temporal memory for AI agents — knows which version is true.**

A memory layer for AI agents that stores knowledge as a temporal graph: it tracks not just *what* is known, but *when each thing was true*, so it can answer "which version is current" — something a plain vector store cannot.

## Language

**Fact**:
A directed, typed relationship between two Entities, expressed as subject → **Predicate** → object (e.g. _Zach → reports-to → Alice_). The only thing in the system that can be superseded. Each Fact carries its **valid time** (when it was true in the world) and its **transaction time** (when the system learned and retired it), and cites the **Source** it was first extracted from — plus any later Sources that **reaffirm** it.
_Avoid_: edge, triple, statement, claim (use **Fact** consistently)

**Entity**:
A distinct thing that Facts connect — a person, document, decision, feature, etc. Carries immutable identifying properties only; anything about it that changes over time is expressed as a Fact, not an attribute.
_Avoid_: node, object, thing

**Predicate**:
The typed relation at the centre of a Fact (e.g. _reports-to_, _lives-in_, _knows_). Each Predicate is declared **single-valued** (a subject has at most one current Fact on it — _reports-to_, _lives-in_) or **multi-valued** (a subject may hold many — _knows_, _contributed-to_). Cardinality is what decides whether a new Fact supersedes a prior one.
_Avoid_: relation, relationship-type, edge-label

**Valid time**:
The interval during which a Fact was true **in the world**, extracted from the Source's content. Independent of when the system found out. Answers "when was this true?"
_Avoid_: effective date, as-of (reserve those for query phrasing, not the model)

**Transaction time**:
The interval during which the **system** held a Fact as current — from when it was ingested to when it was retired by a Supersession. Wall-clock, system-generated. Answers "when did we know this?" Distinct from valid time; conflating the two is the project's signature mistake to avoid.
_Avoid_: ingestion time / system time (acceptable as informal synonyms, but **transaction time** is canonical)

**Supersession**:
The event of a new Fact closing a prior Fact. The prior Fact is **never deleted** — its transaction time is ended and it is retained as history. Triggered two ways: deterministically when a single-valued Predicate gets a new value, or when a **Contradiction** is detected between Facts. Either way the direction (which Fact closes) is decided by valid time — the Fact with the earlier valid-from is the one that closes, so out-of-order ingestion still resolves correctly.
_Avoid_: overwrite, update, invalidate, expire, delete (these imply loss; the old Fact is kept and queryable)

**Contradiction**:
A relationship between two Facts that cannot both be true at the same time, where the newer one supersedes the older — e.g. _Zach → works-at → Acme_ contradicted by _Zach → left → Acme_. Detected by cardinality for single-valued Predicates, and by an LLM for open-ended or cross-Predicate cases. Strictly **temporal**: it is about a later Fact overriding an earlier one, never about two simultaneous Sources disagreeing (that — trust between competing Sources — is out of scope).
_Avoid_: conflict, disagreement (reserve those for the deferred source-trust problem)

**Reaffirmation**:
The event of a later Source re-asserting a Fact that is already **Current**. Unlike a **Supersession**, nothing closes — the existing Fact is unchanged and stays one Fact; the new Source is simply recorded as additional provenance. Distinguishes "we learned this again" from "this changed." A re-statement of an already-Current Fact (same subject → Predicate → object) is a Reaffirmation, never a duplicate Fact.
_Avoid_: duplicate, re-insert, update (no new Fact is created and nothing is overwritten)

**Source**:
A chunk of ingested text from which Facts are extracted, and to which a Fact traces back for provenance ("which Source said this?") — its origin Source, plus any later Sources that **reaffirm** the same Fact. May be a file, a chat message, a transcript — anything textual.
_Avoid_: document, doc, episode, input

**Extraction**:
The act of turning a Source's text into Entities and Facts: identify the entities, resolve them against existing Entities (so "Zach" doesn't fork into duplicates), then pull the typed relationships between them. The bridge from unstructured Source to structured graph.
_Avoid_: parsing, ingestion (ingestion is the whole intake of a Source; Extraction is specifically text → graph)

**Current**:
The state of a Fact that has not been superseded — its transaction time is still open. `recall` returns Current Facts by default; a point-in-time query returns whatever was Current at the given date.
_Avoid_: active, live, latest (use **Current** consistently)

## Example dialogue

> **Dev:** We just ingested the new org chart. Zach reports to Bob now.
> **Domain expert:** Right — _reports-to_ is single-valued, so the Fact _Zach → reports-to → Alice_ gets superseded. We don't delete it; its transaction time ends today and a new Current Fact _Zach → reports-to → Bob_ opens.
> **Dev:** And if someone asks the graph "who does Zach report to?" —
> **Domain expert:** By default they get the Current Fact, Bob. But because the Alice Fact is retained, they can ask point-in-time — "who did Zach report to last quarter?" — and get Alice, because she was Current then. That history is the whole point.
> **Dev:** What about Zach's job title changing?
> **Domain expert:** A title isn't a relationship between two Entities, so it's not a Fact in our model — unless we decide a scenario needs it, in which case we'd model it as a relationship to a Title entity. Otherwise it stays out.

# Hand-built temporal graph on Postgres; no Graphiti, no graph DB

The project's thesis is that the author can build a temporal knowledge platform, so the bi-temporal supersession engine is built in-house rather than delegated to Graphiti (which would also force a Python sidecar, conflicting with the TypeScript stack). A single Postgres instance stores both embeddings (pgvector) and the graph (relational `entities` / `facts` tables with `valid_from`/`valid_to`); there is no separate graph database.

## Considered Options

- **Hand-built on Postgres (chosen).** TypeScript end-to-end; one store; we own the differentiating code.
- **Python + Graphiti + FalkorDB.** Fastest to a working temporal demo, but the library owns the differentiator and the "I built it" story weakens.
- **TS server + Graphiti Python sidecar.** Keeps the TS face but adds a second service and a process boundary; hardest to set up and demo.
- **pgvector + a graph DB together.** Rejected as redundant — overlapping stores are the first thing a reviewer attacks.

## Consequences

- We write the bi-temporal logic and LLM-based fact extraction ourselves — accepted, because a proof-piece should spend its effort exactly there.
- At demo scale (hundreds–thousands of facts), recursive CTEs cover multi-hop traversal, so a graph database earns nothing.
- If the project ever needed production-scale graph traversal, this decision would be revisited.

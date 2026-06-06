# DSPy as an offline prompt optimizer; ship static compiled prompts

Extraction and contradiction prompts are tuned with DSPy, but **DSPy runs offline at development time only — it is never a runtime dependency.** The TypeScript server ships DSPy's compiled output (optimized instructions + bootstrapped few-shot demonstrations) as static prompt assets loaded at runtime.

Rationale: the stack is TypeScript and we forbid a Python runtime sidecar (consistent with ADR 0001's no-Graphiti reasoning); DSPy is Python-only. Using it offline gets the optimization benefit while keeping Python entirely out of the shipped artifact.

## Workflow

1. Seed prompts from Graphiti's `extract_edges` / `resolve_edge` prompts (battle-tested starting point).
2. Establish a hand-tuned baseline against the gold eval set.
3. Run DSPy (e.g. MIPROv2 / BootstrapFewShot) to optimize against the eval metric.
4. Export the optimized instructions + few-shot demonstrations as static assets; load them in the TS app.
5. Report the lift (baseline F1 → optimized F1).

## Considered Options

- **DSPy offline → static export (chosen).**
- **DSPy as a runtime dependency / Python extraction service** — rejected; reintroduces the Python/TS split.
- **Promptfoo (TS-native)** — stays in-ecosystem but has weaker optimizers.
- **Pure hand-iteration against the metric** — kept as the fallback if DSPy doesn't beat the baseline.

## Consequences

- A dev-only Python toolchain plus a compile/export step live in the repo, clearly fenced off from the shipped TypeScript.
- The DSPy step is additive: if it fails to beat the hand-tuned baseline, the baseline ships and the eval harness still stands on its own.

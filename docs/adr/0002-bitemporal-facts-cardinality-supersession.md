# Bi-temporal Facts with two-path supersession

Facts are bi-temporal: **valid time** (`valid_at` / `invalid_at`, extracted from Source content — when the fact was true in the world) and **transaction time** (`created_at` / `expired_at`, wall-clock — when the system held it as current). A Fact is current iff `expired_at IS NULL`; point-in-time queries filter on valid time (`valid_at <= T AND (invalid_at IS NULL OR invalid_at > T)`). Facts are expired, never deleted.

Supersession has **two trigger paths**, both resolved by the same valid-time direction rule:

1. **Cardinality (deterministic, demo path).** Predicates are tagged single- or multi-valued in a curated registry (unknown → multi-valued, fail-safe). A new current Fact on a single-valued predicate closes the prior one. Deterministic and explainable — this is what the recorded demo runs on, so the on-stage supersession fires every time.
2. **LLM-judged contradiction (general, off the critical demo path).** Built directly from Graphiti's mechanism (`graphiti_core/utils/maintenance/edge_operations.py`): retrieve candidate Facts by semantic similarity, one LLM call nominates which are `contradicted`, then the temporal gate decides direction. Catches what cardinality cannot — cross-predicate contradiction ("works-at" vs "left"), state flips on multi-valued relations, and detail updates.

In both paths the **direction** (which Fact closes) is set by Graphiti's valid-time interval rule (`resolve_edge_contradictions`): the Fact with the earlier `valid_at` is closed, and a newly-ingested Fact that is actually older than an existing one is born already-expired — so out-of-order ingestion resolves correctly.

## Relationship to Graphiti

Graphiti's *only* supersession mechanism is LLM-judged contradiction (it has no cardinality concept). We keep that mechanism in full and **add** the deterministic cardinality path on top, specifically so a filmed demo is reproducible while open-ended contradiction is still handled. "Deterministic where it must be, Graphiti-grade where it counts."

## Scope boundary

This ADR covers **temporal** contradiction — a new Fact superseding an older one over time. It explicitly does **not** cover **source-contradiction / trust-ranking** (two sources disagreeing at the *same* time, requiring a who-do-we-believe decision). That is a distinct problem, deferred.

## Consequences

- Requires maintaining a curated predicate registry for the cardinality path.
- The LLM-judged path adds nondeterminism to ingestion; kept off the critical demo path so demo reproducibility is unaffected.

import type { Fact } from "../domain/types.js";
import type { TemporalGraphStore } from "../db/store.js";
import type { ProviderClient } from "../provider/types.js";
/**
 * LLM-judged contradiction (slice 12, ADR 0002) — the general path cardinality
 * can't express (cross-Predicate "works-at" vs "left", state flips). Mechanism
 * (from Graphiti's resolve_edge_contradictions): retrieve candidate current
 * Facts → ONE LLM call nominates which the new Fact contradicts → the SAME
 * valid-time direction rule from slice 03 sets which Fact closes.
 *
 * Kept off the critical demo path (the demo runs on deterministic cardinality);
 * because the LLM step is nondeterministic, acceptance is metric-based.
 */
export interface NewFactRef {
    id: string;
    subjectId: string;
    subject: string;
    predicate: string;
    object: string;
    validAt: Date | null;
}
export interface ContradictionDeps {
    store: TemporalGraphStore;
    provider: ProviderClient;
    now?: () => Date;
    /** Override the contradiction model (defaults to the provider's completion model). */
    model?: string;
}
/**
 * Detect and resolve contradictions for a just-inserted Fact. Returns the Facts
 * that were superseded (closed). Best-effort: any LLM/parse failure resolves to
 * "no contradictions" so ingestion never breaks.
 */
export declare function resolveContradictions(deps: ContradictionDeps, newFact: NewFactRef): Promise<Fact[]>;

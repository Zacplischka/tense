import type { TemporalGraphStore } from "./db/store.js";
import type { Extractor } from "./extraction/types.js";
import type { EntityResolver } from "./resolution/entity-resolver.js";
import type { PredicateRegistry } from "./supersession/registry.js";
import type { ProviderClient } from "./provider/types.js";
/**
 * The converged ingest path (slice 07): remember = extract → resolve Entities →
 * supersede (cardinality) → persist atomically, then embed best-effort. The
 * three independently-built modules become one pipeline here.
 */
export interface RememberDeps {
    store: TemporalGraphStore;
    extractor: Extractor;
    resolver: EntityResolver;
    registry: PredicateRegistry;
    /** Optional: embeddings for hybrid recall. Omitted in unit tests. */
    provider?: ProviderClient;
    /** Injectable clock so transaction time is deterministic in tests. */
    now?: () => Date;
    /**
     * Enable the LLM-judged contradiction path (cross-Predicate, off the critical
     * demo path). Requires `provider`. Default off so the demo stays deterministic.
     */
    enableContradiction?: boolean;
}
export interface FactSummary {
    id: string;
    subject: string;
    predicate: string;
    object: string;
}
/**
 * A Fact retired by this ingest, tagged with WHY it closed. `cardinality`: a
 * single-valued Predicate received a new object (same Predicate, e.g. reports-to
 * Alice → reports-to Bob). `contradiction`: an LLM-judged cross-Predicate conflict
 * (e.g. "works-at Acme" retired by "left Acme"). The two are otherwise
 * indistinguishable in the summary — and a contradiction retires a Fact whose
 * predicate DIFFERS from the one just stated — so this flag is how a caller tells
 * a routine update apart from a semantic conflict.
 */
export interface SupersededFact extends FactSummary {
    reason: "cardinality" | "contradiction";
}
/**
 * How one extracted name resolved during ingest (PRD US-10). The resolver already
 * decides this; surfacing it lets a caller SEE when a variant was fuzzy-merged into
 * an existing Entity (e.g. "Zachery" → "Zachary") and catch a wrong merge, instead
 * of the decision happening silently.
 */
export interface EntityResolution {
    /** The name as it appeared in the Source text. */
    input: string;
    /** The Entity it resolved to (existing match, or newly created). */
    resolvedTo: string;
    /** exact / fuzzy match against an existing Entity, or a new Entity created. */
    reason: "exact" | "fuzzy" | "new";
    /** Trigram similarity to the matched Entity (fuzzy matches only). */
    similarity?: number;
}
export interface RememberSummary {
    sourceId: string;
    factsCreated: FactSummary[];
    factsSuperseded: SupersededFact[];
    /**
     * Facts already Current and re-stated by this Source (ADR 0005). No new Fact
     * is created; the Source is recorded as additional provenance. Distinguishes
     * "we learned this again" from "this changed" (factsSuperseded).
     */
    factsReaffirmed: FactSummary[];
    /**
     * One entry per distinct name mentioned in the Source, recording how entity
     * resolution placed it (exact/fuzzy/new). Surfaces fuzzy merges for review.
     */
    entitiesResolved: EntityResolution[];
}
export declare function remember(deps: RememberDeps, text: string, sourceLabel?: string | null): Promise<RememberSummary>;

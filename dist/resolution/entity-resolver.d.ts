import type pg from "pg";
/**
 * Entity resolution so the same real-world Entity under name variants resolves
 * to one node instead of forking the graph (PRD US-10). Cascade:
 *   1. exact normalized-name match
 *   2. pg_trgm trigram fuzzy match (typos / variants like Zach↔Zachary)
 *   3. short-name guard — reject a fuzzy match when BOTH names are short, so
 *      similar-but-distinct short names (Zach vs Zara) never merge.
 * No LLM tiebreak in v1 (deferred).
 */
export type ResolutionReason = "exact" | "fuzzy" | "new";
export interface ResolutionResult {
    /** Existing Entity id, or null to signal "create a new Entity". */
    entityId: string | null;
    reason: ResolutionReason;
    matched?: {
        id: string;
        name: string;
        similarity: number;
    };
}
export interface EntityResolverOptions {
    /** Minimum trigram similarity to accept a fuzzy match (0..1). */
    fuzzyThreshold?: number;
    /** Names this length or shorter are "short" for the guard. */
    shortNameLen?: number;
}
export declare class EntityResolver {
    private readonly pool;
    private readonly fuzzyThreshold;
    private readonly shortNameLen;
    constructor(pool: pg.Pool, opts?: EntityResolverOptions);
    resolve(candidateName: string): Promise<ResolutionResult>;
}

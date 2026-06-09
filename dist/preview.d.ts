import type { RememberDeps, EntityResolution } from "./pipeline.js";
/**
 * Dry-run of {@link remember}: report what ingesting `text` WOULD do — Facts it
 * would create / supersede / reaffirm, and how each name resolves — WITHOUT
 * writing anything. Lets an agent preview the side effects of a Source (and the
 * supersessions it would trigger) before committing it to memory.
 *
 * It runs the SAME decision the real path runs: extraction, read-only entity
 * resolution, and the pure {@link resolveSupersession} cardinality resolver — so
 * preview and remember agree by construction. The contradiction (LLM) path is not
 * simulated; preview covers the deterministic cardinality path that the default
 * ingest runs on.
 *
 * Limitation: it simulates against the graph's CURRENT state, not intra-batch
 * effects — if one `text` contains several Facts about a brand-new subject that
 * supersede each other, those later supersessions aren't reflected (the subject
 * doesn't exist yet to query). Accurate for the common case: previewing a Source
 * against existing memory.
 */
export interface PreviewFact {
    subject: string;
    predicate: string;
    object: string;
}
export interface RememberPreview {
    /** Facts that would be created (new relationships, including born-historical ones). */
    factsToCreate: PreviewFact[];
    /** Existing Current Facts that would be superseded (closed, never deleted). */
    factsToSupersede: PreviewFact[];
    /** Existing Current Facts that would simply gain this Source as provenance. */
    factsToReaffirm: PreviewFact[];
    /** How each distinct name would resolve (new / exact / fuzzy). */
    entitiesResolved: EntityResolution[];
}
export declare function previewRemember(deps: RememberDeps, text: string): Promise<RememberPreview>;

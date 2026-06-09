/**
 * Extraction interface: turn a Source's prose into Entities and Facts. Both the
 * LLM extractor (slice 05) and the deterministic stub (slice 01) implement it,
 * so the ingest pipeline (slice 07) depends on the interface, not the model.
 */
export interface ExtractedEntity {
    name: string;
}
export interface ExtractedFact {
    subject: string;
    predicate: string;
    object: string;
    /** Valid time, extracted from Source content; null when not stated. */
    validAt: Date | null;
    invalidAt: Date | null;
}
export interface ExtractionResult {
    entities: ExtractedEntity[];
    facts: ExtractedFact[];
}
export interface Extractor {
    /**
     * @param sourceText prose to extract from
     * @param knownEntities existing Entity names, as resolution hints to the model
     */
    extract(sourceText: string, knownEntities?: string[]): Promise<ExtractionResult>;
}
/** Thrown when extraction output can't be parsed/validated — handled gracefully. */
export declare class ExtractionError extends Error {
    constructor(message: string);
}

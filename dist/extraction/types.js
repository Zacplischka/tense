/**
 * Extraction interface: turn a Source's prose into Entities and Facts. Both the
 * LLM extractor (slice 05) and the deterministic stub (slice 01) implement it,
 * so the ingest pipeline (slice 07) depends on the interface, not the model.
 */
/** Thrown when extraction output can't be parsed/validated — handled gracefully. */
export class ExtractionError extends Error {
    constructor(message) {
        super(message);
        this.name = "ExtractionError";
    }
}
//# sourceMappingURL=types.js.map
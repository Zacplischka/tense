import { TemporalGraphStore } from "./db/store.js";
import { LlmExtractor } from "./extraction/llm-extractor.js";
import { EntityResolver } from "./resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "./supersession/registry.js";
import { createProvider } from "./provider/openrouter.js";
/**
 * Single source of truth for the `remember` ingest dependencies (ADR 0004).
 *
 * Both ingest entry points build their pipeline through this one factory — the
 * MCP stdio server (`src/server.ts`) and the viewer's `POST /api/remember` route
 * — so the wiring (LLM extractor, fuzzy entity resolver, predicate registry,
 * OpenRouter provider, and the cross-Predicate contradiction path) can never
 * drift between them. `createProvider()` validates OPENROUTER_API_KEY / models.
 */
export function createRememberDeps(pool) {
    const provider = createProvider();
    return {
        store: new TemporalGraphStore(pool),
        extractor: new LlmExtractor(provider),
        resolver: new EntityResolver(pool),
        registry: defaultPredicateRegistry(),
        provider,
        enableContradiction: true, // general cross-Predicate path (cardinality is always on)
    };
}
//# sourceMappingURL=remember-deps.js.map
import { type PredicateRegistry } from "../supersession/registry.js";
/**
 * Static extraction prompt assets (ADR 0003: ship static, DSPy-optimize offline).
 * Seeded from the spirit of Graphiti's extract_edges/resolve_edge prompts:
 * pull entities, then typed subject→predicate→object Facts, with valid time when
 * the text states it. Slice 14 may replace these with DSPy-compiled versions.
 */
export declare const EXTRACTION_SYSTEM_PROMPT = "You extract a temporal knowledge graph from text.\n\nReturn STRICT JSON (no prose, no markdown) with this exact shape:\n{\n  \"entities\": [{ \"name\": string }],\n  \"facts\": [{\n    \"subject\": string,\n    \"predicate\": string,\n    \"object\": string,\n    \"valid_at\": string | null,\n    \"invalid_at\": string | null\n  }]\n}\n\nRules:\n- Entities are distinct things worth tracking: people, places, orgs, products,\n  features, AND tools, libraries, languages, frameworks, services, files,\n  components, concepts, and decisions. Use the cleanest canonical name; reuse a\n  known entity name when the text clearly refers to it.\n- A Fact is a directed relationship subject -> predicate -> object, where BOTH\n  subject and object are entities. A relationship to another named thing IS a\n  Fact (e.g. \"Tense uses pgvector\" -> Tense -uses-> pgvector; \"Zach prefers pnpm\"\n  -> Zach -prefers-> pnpm). Only skip a bare single-entity attribute with no\n  second entity (e.g. \"Tense is fast\").\n- predicate must be a lowercase hyphenated slug. Prefer a known predicate (listed\n  below) when one fits; otherwise COIN a precise slug rather than dropping a\n  clearly-stated relationship. Common slugs: reports-to, lives-in, works-at,\n  knows, left, uses, prefers, depends-on, built-with, runs-on, stores-data-in,\n  implements, replaces, part-of, integrates-with, decided-on, working-on.\n- valid_at: an ISO-8601 date (YYYY-MM-DD) for when the fact became true in the\n  world, ONLY if the text states or clearly implies it; otherwise null. Do not\n  guess. Relative words like \"now\"/\"currently\" with no date => null.\n- invalid_at: an ISO-8601 date for when it stopped being true, if stated;\n  otherwise null.\n- Output only the JSON object.";
/**
 * A DSPy-compiled static asset (ADR 0003): optimized instructions + bootstrapped
 * few-shot demonstrations. Shipped as JSON; no Python at runtime.
 */
export interface CompiledExtraction {
    instructions: string;
    demos: Array<{
        source: string;
        output: unknown;
    }>;
    meta?: Record<string, unknown>;
}
/** Load the DSPy-compiled asset if present; null when none has been exported. */
export declare function loadCompiledExtraction(): CompiledExtraction | null;
/**
 * Resolve the system prompt + few-shot block from a compiled asset, falling back
 * to the hand-tuned baseline when none exists. Pure (asset injected) so it is
 * unit-testable — this is the seam DSPy's offline output plugs into.
 */
export declare function resolveExtractionPrompt(compiled: CompiledExtraction | null): {
    system: string;
    fewShot: string;
};
export declare function buildExtractionUserPrompt(sourceText: string, knownEntities?: string[], registry?: PredicateRegistry): string;

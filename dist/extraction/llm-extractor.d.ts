import type { ProviderClient } from "../provider/types.js";
import { type PredicateRegistry } from "../supersession/registry.js";
import { type ExtractionResult, type Extractor } from "./types.js";
export interface LlmExtractorOptions {
    model?: string;
    registry?: PredicateRegistry;
}
/**
 * LLM-backed extractor: structured-output completion -> schema-validated graph.
 * Malformed or non-JSON output raises {@link ExtractionError} so the caller can
 * surface a clean error without crashing (slice 07 keeps the MCP server alive).
 */
export declare class LlmExtractor implements Extractor {
    private readonly provider;
    private readonly opts;
    private readonly registry;
    constructor(provider: ProviderClient, opts?: LlmExtractorOptions);
    extract(sourceText: string, knownEntities?: string[]): Promise<ExtractionResult>;
}

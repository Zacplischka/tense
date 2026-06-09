import { type Config } from "../config.js";
import type { CompletionRequest, CompletionResult, ProviderClient } from "./types.js";
export interface OpenRouterOptions {
    apiKey: string;
    defaultCompletionModel: string;
    defaultEmbeddingModel: string;
    baseUrl?: string;
    /** Injectable for tests — defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Retries for transient failures (429 / 5xx / network). Default 2 (3 attempts). */
    maxRetries?: number;
    /** Base backoff in ms; doubled per attempt (250 → 500 …). Default 250; set 0 in tests. */
    retryDelayMs?: number;
}
/**
 * Thin OpenRouter (OpenAI-compatible) client for completions and embeddings.
 * Holds no prompt or extraction logic — just transport + model selection.
 */
export declare class OpenRouterClient implements ProviderClient {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly completionModel;
    private readonly embeddingModel;
    private readonly fetchImpl;
    private readonly maxRetries;
    private readonly retryDelayMs;
    constructor(opts: OpenRouterOptions);
    complete(req: CompletionRequest): Promise<CompletionResult>;
    embed(texts: string[], model?: string): Promise<number[][]>;
    private post;
}
/**
 * Validate the provider config and build a client from it. Throws a clear,
 * actionable error when required settings are missing — called at startup so
 * misconfiguration fails fast rather than mid-request.
 */
export declare function createProvider(config?: Config): OpenRouterClient;

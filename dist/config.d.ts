/**
 * Runtime configuration, read from the environment with sensible local defaults.
 *
 * Only `databaseUrl` is required to boot. The model/key fields are declared here
 * so the shape is stable, but are validated at the provider boundary (where the
 * key is actually used), not here — so the stub-extractor paths (tests, offline
 * eval, demo seed) run with no OpenRouter key.
 */
export interface Config {
    /** Postgres connection string. */
    databaseUrl: string;
    /** Completion model id passed through to OpenRouter. */
    extractionModel: string;
    /** Embedding model id passed through to OpenRouter. */
    embeddingModel: string;
    /** OpenRouter API key; undefined on the no-key paths (stub extractor, no LLM). */
    openrouterApiKey: string | undefined;
}
export declare function loadConfig(env?: NodeJS.ProcessEnv): Config;

/**
 * Runtime configuration, read from the environment with sensible local defaults.
 *
 * Slice 01 only consumes `databaseUrl`. The model/key fields are declared now so
 * the shape is stable for the provider client (slice 02) and are validated there,
 * not here — slice 01 must run with no OpenRouter key.
 */
export interface Config {
  /** Postgres connection string. */
  databaseUrl: string;
  /** Completion model id passed through to OpenRouter (slice 02+). */
  extractionModel: string;
  /** Embedding model id passed through to OpenRouter (slice 02+). */
  embeddingModel: string;
  /** OpenRouter API key; absent in slice 01 (stub extractor, no LLM). */
  openrouterApiKey: string | undefined;
}

const DEFAULT_DATABASE_URL = "postgres://postgres:tense@localhost:5432/tense";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.TENSE_DATABASE_URL ?? DEFAULT_DATABASE_URL,
    extractionModel: env.TENSE_EXTRACTION_MODEL ?? "openai/gpt-4o-mini",
    embeddingModel: env.TENSE_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    openrouterApiKey: env.OPENROUTER_API_KEY,
  };
}

const DEFAULT_DATABASE_URL = "postgres://postgres:tense@localhost:5432/tense";
export function loadConfig(env = process.env) {
    return {
        databaseUrl: env.TENSE_DATABASE_URL ?? DEFAULT_DATABASE_URL,
        extractionModel: env.TENSE_EXTRACTION_MODEL ?? "openai/gpt-4o-mini",
        embeddingModel: env.TENSE_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
        openrouterApiKey: env.OPENROUTER_API_KEY,
    };
}
//# sourceMappingURL=config.js.map
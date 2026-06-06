-- Embeddings for hybrid recall (slice 02 stores; slice 09 searches).
--
-- Dimension is fixed to the configured embedding model (OpenRouter
-- text-embedding-3-small = 1536). Switching to a model with a different
-- dimension requires a new migration. Nullable: a Fact may exist before it is
-- embedded, and embedding is best-effort (never blocks a write).

ALTER TABLE facts ADD COLUMN IF NOT EXISTS embedding vector(1536);

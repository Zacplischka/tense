-- Trigram GIN index on entities.normalized_name (pg_trgm was enabled in 0001).
--
-- The `entities` tool's name search filters with `normalized_name ILIKE '%q%'`,
-- which a B-tree can't serve (leading wildcard) — so it was a sequential scan that
-- evaluated the pattern per row, O(entities) per search. A pg_trgm GIN index lets
-- Postgres satisfy the ILIKE from the index (trigram match), so entity browse /
-- search scales past demo size. Transparent to results.
--
-- Scope: this accelerates the ILIKE search only. The entity RESOLVER's fuzzy
-- lookup uses `similarity() >= threshold`, which this index does not accelerate
-- without a query rewrite (deferred — see .codeloop backlog: the rewrite must not
-- couple the 0.4 threshold to the `%`-operator GUC).
CREATE INDEX IF NOT EXISTS idx_entities_normalized_name_trgm
    ON entities USING gin (normalized_name gin_trgm_ops);

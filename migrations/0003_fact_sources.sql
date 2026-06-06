-- Reaffirmation (ADR 0005): a Fact may be asserted by more than one Source.
--
-- `facts.source_id` is retained as the ORIGIN (first) Source so existing reads,
-- recall, and history are unchanged. This join records EVERY Source that has
-- asserted a Fact, so re-stating an already-Current Fact (same subject ->
-- predicate -> object) appends provenance here instead of duplicating the Fact.
-- "Reinforced N times" is the count of rows for a fact_id.

CREATE TABLE IF NOT EXISTS fact_sources (
    fact_id    uuid        NOT NULL REFERENCES facts (id)   ON DELETE CASCADE,
    source_id  uuid        NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (fact_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_fact_sources_fact ON fact_sources (fact_id);

-- Backfill: every existing Fact's origin Source becomes its first provenance row.
INSERT INTO fact_sources (fact_id, source_id, created_at)
SELECT id, source_id, created_at FROM facts
ON CONFLICT DO NOTHING;

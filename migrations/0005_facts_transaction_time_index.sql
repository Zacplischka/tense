-- Transaction-time indexes for the `changes` feed and time-ordered reads (perf).
--
-- The bi-temporal `changes` feed (incremental sync, ADR 0002) filters Facts by
-- transaction time — created_at >= since (LEARNED) OR expired_at >= since (RETIRED).
-- With no index on those columns it seq-scans the whole facts table on every poll;
-- these let Postgres index-scan each side (and BitmapOr the two for the feed).
-- `created_at` additionally serves the newest-first orderings of the empty-query
-- browse path, the history chain's tiebreak, and the viewer snapshot.
--
-- Additive only: no query changes, results identical. Matters at scale — at demo
-- size the planner seq-scans a tiny table regardless (the same reason the trgm
-- index in 0004 only shows up with enable_seqscan off).

CREATE INDEX IF NOT EXISTS idx_facts_created_at
    ON facts (created_at);

-- Partial: only retired Facts carry expired_at, so this stays small and matches
-- the feed's `expired_at IS NOT NULL AND expired_at >= since` clause exactly.
CREATE INDEX IF NOT EXISTS idx_facts_expired_at
    ON facts (expired_at)
    WHERE expired_at IS NOT NULL;

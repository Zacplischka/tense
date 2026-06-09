import type { RecalledFact, TemporalGraphStore } from "../db/store.js";
import type { ProviderClient } from "../provider/types.js";
export interface RecallDeps {
    store: TemporalGraphStore;
    /** Optional: enables the semantic ranker. Falls back to keyword-only without it. */
    provider?: ProviderClient;
}
export interface RecallOptions {
    /** null/undefined = Current; a date = whatever was Current (valid) at that instant. */
    asOf?: Date | null;
    limit?: number;
    /**
     * Restrict results to a single Predicate (e.g. "reports-to"). Normalized to the
     * canonical slug (lowercased, spaces → hyphens) so "Reports To" also matches.
     */
    predicate?: string | null;
    /**
     * Only return Facts asserted by at least this many Sources (the `reinforcedBy`
     * provenance count) — a trust threshold for high-stakes recall. Filtered in SQL
     * before the limit, so you still get the top matches that clear the bar.
     */
    minReinforced?: number | null;
    /**
     * Attach `citedBy` (the Sources asserting each Fact — origin + Reaffirmations) to
     * every result. Off by default so the common path stays lean; turn on to audit
     * WHICH Sources back each Fact, not just how many (`reinforcedBy`).
     */
    includeSources?: boolean;
    /**
     * Include the full `source.text` on each result (default true). Set false for a
     * token-lean recall over long Sources — `source` then carries only `id`/`label`,
     * and full text can be re-fetched via the `sources` tool.
     */
    includeSourceText?: boolean;
}
/**
 * Hybrid point-in-time recall (slice 09): pgvector cosine + Postgres full-text,
 * fused with RRF, over a temporally-filtered candidate set.
 *
 * Order is **filter-then-fuse**: each ranker applies the temporal filter in SQL
 * (Current, or valid-at-`asOf`), so superseded Facts never enter the ranking;
 * RRF then fuses the two ranked lists. Every result carries its Source citation
 * and validity interval.
 */
export declare function recall(deps: RecallDeps, query: string, opts?: RecallOptions): Promise<RecalledFact[]>;

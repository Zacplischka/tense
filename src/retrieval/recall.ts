import type { RecalledFact, TemporalGraphStore } from "../db/store.js";
import type { ProviderClient } from "../provider/types.js";
import { reciprocalRankFusion } from "./rrf.js";

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
}

/** Canonicalize a Predicate filter to the stored slug form, or null if blank. */
function normalizePredicateFilter(predicate: string | null | undefined): string | null {
  const p = predicate?.trim().toLowerCase().replace(/\s+/g, "-");
  return p ? p : null;
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
export async function recall(
  deps: RecallDeps,
  query: string,
  opts: RecallOptions = {},
): Promise<RecalledFact[]> {
  const { store, provider } = deps;
  const asOf = opts.asOf ?? null;
  const limit = opts.limit ?? 20;
  const predicate = normalizePredicateFilter(opts.predicate);
  const minReinforced = opts.minReinforced && opts.minReinforced > 0 ? Math.floor(opts.minReinforced) : null;
  const q = query.trim();

  let result: RecalledFact[];

  if (q === "") {
    // Empty query: browse the temporally-filtered set, no relevance ranking.
    result = await store.recallByTemporal(asOf, limit, predicate, minReinforced);
  } else {
    const candidateLimit = Math.max(limit * 2, 20);
    const keyword = await store.rankByKeyword(q, asOf, candidateLimit, predicate, minReinforced);

    let semantic: string[] = [];
    if (provider) {
      try {
        const [embedding] = await provider.embed([q]);
        if (embedding) semantic = await store.rankBySemantic(embedding, asOf, candidateLimit, predicate, minReinforced);
      } catch (err) {
        // Best-effort: keyword + temporal filter still answer the query. Warn (stderr,
        // never stdout/MCP) so a failing embedding provider doesn't silently drop the
        // semantic ranker on every recall without anyone noticing.
        console.error(
          "[tense] query embedding failed; falling back to keyword-only recall:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const fusedIds = reciprocalRankFusion([semantic, keyword]).slice(0, limit);
    const byId = await store.loadRecalledByIds(fusedIds);
    result = fusedIds
      .map((id) => byId.get(id))
      .filter((f): f is RecalledFact => f !== undefined);
  }

  // Opt-in provenance detail: attach the Sources that assert each Fact. One batched
  // query, only when requested — keeps the default result lean.
  if (opts.includeSources && result.length > 0) {
    const byFact = await store.citingSourcesFor(result.map((f) => f.id));
    for (const f of result) f.citedBy = byFact.get(f.id) ?? [];
  }

  return result;
}

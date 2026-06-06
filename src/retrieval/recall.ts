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
  const q = query.trim();

  // Empty query: browse the temporally-filtered set, no relevance ranking.
  if (q === "") return store.recallByTemporal(asOf, limit);

  const candidateLimit = Math.max(limit * 2, 20);
  const keyword = await store.rankByKeyword(q, asOf, candidateLimit);

  let semantic: string[] = [];
  if (provider) {
    try {
      const [embedding] = await provider.embed([q]);
      if (embedding) semantic = await store.rankBySemantic(embedding, asOf, candidateLimit);
    } catch {
      // semantic is best-effort; keyword + temporal filter still answer the query
    }
  }

  const fusedIds = reciprocalRankFusion([semantic, keyword]).slice(0, limit);
  if (fusedIds.length === 0) return [];

  const byId = await store.loadRecalledByIds(fusedIds);
  return fusedIds
    .map((id) => byId.get(id))
    .filter((f): f is RecalledFact => f !== undefined);
}

import { reciprocalRankFusion } from "./rrf.js";
/** Canonicalize a Predicate filter to the stored slug form, or null if blank. */
function normalizePredicateFilter(predicate) {
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
export async function recall(deps, query, opts = {}) {
    const { store, provider } = deps;
    const asOf = opts.asOf ?? null;
    const limit = opts.limit ?? 20;
    const predicate = normalizePredicateFilter(opts.predicate);
    const minReinforced = opts.minReinforced && opts.minReinforced > 0 ? Math.floor(opts.minReinforced) : null;
    const q = query.trim();
    let result;
    if (q === "") {
        // Empty query: browse the temporally-filtered set, no relevance ranking.
        result = await store.recallByTemporal(asOf, limit, predicate, minReinforced);
    }
    else {
        const candidateLimit = Math.max(limit * 2, 20);
        const keyword = await store.rankByKeyword(q, asOf, candidateLimit, predicate, minReinforced);
        let semantic = [];
        if (provider) {
            try {
                const [embedding] = await provider.embed([q]);
                if (embedding)
                    semantic = await store.rankBySemantic(embedding, asOf, candidateLimit, predicate, minReinforced);
            }
            catch (err) {
                // Best-effort: keyword + temporal filter still answer the query. Warn (stderr,
                // never stdout/MCP) so a failing embedding provider doesn't silently drop the
                // semantic ranker on every recall without anyone noticing.
                console.error("[tense] query embedding failed; falling back to keyword-only recall:", err instanceof Error ? err.message : err);
            }
        }
        const fusedIds = reciprocalRankFusion([semantic, keyword]).slice(0, limit);
        const byId = await store.loadRecalledByIds(fusedIds);
        result = fusedIds
            .map((id) => byId.get(id))
            .filter((f) => f !== undefined);
    }
    // Opt-in provenance detail: attach the Sources that assert each Fact. One batched
    // query, only when requested — keeps the default result lean.
    if (opts.includeSources && result.length > 0) {
        const byFact = await store.citingSourcesFor(result.map((f) => f.id));
        for (const f of result)
            f.citedBy = byFact.get(f.id) ?? [];
    }
    // Token-lean mode: drop the full Source text (keep id/label) on request.
    if (opts.includeSourceText === false) {
        for (const f of result)
            f.source = { id: f.source.id, label: f.source.label };
    }
    return result;
}
//# sourceMappingURL=recall.js.map
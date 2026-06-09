/**
 * Reciprocal Rank Fusion: combine several ranked id lists into one. Each list
 * contributes 1/(k + rank) per item (rank is 1-based). The constant `k` is
 * pinned at 60 (the canonical RRF value); a larger k flattens the influence of
 * top ranks. Pure and deterministic — the unit of the recall ranking test.
 */
export const RRF_K = 60;
export function reciprocalRankFusion(rankedLists, k = RRF_K) {
    const score = new Map();
    for (const list of rankedLists) {
        list.forEach((id, index) => {
            const rank = index + 1;
            score.set(id, (score.get(id) ?? 0) + 1 / (k + rank));
        });
    }
    // Map preserves insertion order; V8's sort is stable, so ties fall back to
    // first-appearance order across the input lists — deterministic.
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
//# sourceMappingURL=rrf.js.map
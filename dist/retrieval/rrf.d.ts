/**
 * Reciprocal Rank Fusion: combine several ranked id lists into one. Each list
 * contributes 1/(k + rank) per item (rank is 1-based). The constant `k` is
 * pinned at 60 (the canonical RRF value); a larger k flattens the influence of
 * top ranks. Pure and deterministic — the unit of the recall ranking test.
 */
export declare const RRF_K = 60;
export declare function reciprocalRankFusion(rankedLists: string[][], k?: number): string[];

import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, RRF_K } from "../src/retrieval/rrf.js";

describe("reciprocalRankFusion", () => {
  it("ranks an item appearing high in both lists above single-list items", () => {
    const semantic = ["a", "b", "c"];
    const keyword = ["b", "a", "d"];
    // b: 1/(k+2)+1/(k+1); a: 1/(k+1)+1/(k+2) — equal to b. Tie broken by
    // first-appearance (a appears first in the semantic list).
    expect(reciprocalRankFusion([semantic, keyword])).toEqual(["a", "b", "c", "d"]);
  });

  it("rewards consensus: an item ranked #1 in both beats an item #1 in one", () => {
    const l1 = ["x", "y"];
    const l2 = ["x", "z"];
    const fused = reciprocalRankFusion([l1, l2]);
    expect(fused[0]).toBe("x"); // in both at rank 1
  });

  it("handles an item present in only one list", () => {
    expect(reciprocalRankFusion([["a"], ["b"]])).toEqual(["a", "b"]);
  });

  it("uses the pinned k=60 by default", () => {
    expect(RRF_K).toBe(60);
  });

  it("returns [] for no lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { ingestSummaryMessage } from "../viewer/lib/ingest-summary.js";

describe("ingestSummaryMessage (viewer ingest status)", () => {
  it("reports created / superseded / reaffirmed counts", () => {
    expect(
      ingestSummaryMessage({
        factsCreated: [{}],
        factsSuperseded: [{ reason: "cardinality" }],
        factsReaffirmed: [{}, {}],
      }),
    ).toBe("✓ 1 created · 1 superseded · 2 reaffirmed");
  });

  it("notes how many supersessions were cross-Predicate contradictions", () => {
    expect(
      ingestSummaryMessage({
        factsCreated: [{}],
        factsSuperseded: [{ reason: "contradiction" }, { reason: "cardinality" }],
      }),
    ).toBe("✓ 1 created · 2 superseded (1 by contradiction) · 0 reaffirmed");
  });

  it("omits the contradiction note when all supersessions are cardinality", () => {
    const msg = ingestSummaryMessage({ factsSuperseded: [{ reason: "cardinality" }] });
    expect(msg).toContain("1 superseded");
    expect(msg).not.toContain("contradiction");
  });

  it("surfaces fuzzy entity merges and ignores exact/new resolutions", () => {
    expect(
      ingestSummaryMessage({
        factsCreated: [{}],
        entitiesResolved: [
          { reason: "fuzzy", input: "Zachery", resolvedTo: "Zachary" },
          { reason: "exact", input: "Alice", resolvedTo: "Alice" },
          { reason: "new", input: "Acme", resolvedTo: "Acme" },
        ],
      }),
    ).toBe("✓ 1 created · 0 superseded · 0 reaffirmed · merged Zachery→Zachary");
  });

  it("reports an empty ingest distinctly", () => {
    expect(ingestSummaryMessage({})).toBe("No Facts found in that text.");
    expect(ingestSummaryMessage({ factsCreated: [], factsSuperseded: [], factsReaffirmed: [] })).toBe(
      "No Facts found in that text.",
    );
  });
});

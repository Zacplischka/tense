import { describe, expect, it } from "vitest";
import { StubExtractor } from "../src/extraction/stub.js";

const extractor = new StubExtractor();

describe("StubExtractor (pure, deterministic)", () => {
  it("extracts a single-valued reports-to Fact with null valid_at for prose", () => {
    expect(extractor.extract("Zach reports to Alice.")).toEqual([
      { subject: "Zach", predicate: "reports-to", object: "Alice", validAt: null },
    ]);
  });

  it("parses an explicit leading [YYYY-MM-DD] as valid_at", () => {
    const [fact] = extractor.extract("[2024-06-01] Zach reports to Bob.");
    expect(fact?.validAt?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(fact).toMatchObject({ subject: "Zach", predicate: "reports-to", object: "Bob" });
  });

  it("normalizes surface phrasings to canonical Predicate slugs", () => {
    expect(extractor.extract("Bob lives in Berlin.")[0]?.predicate).toBe("lives-in");
    expect(extractor.extract("Alice knows Carol.")[0]?.predicate).toBe("knows");
    expect(extractor.extract("Dana contributed to Tense.")[0]?.predicate).toBe("contributed-to");
  });

  it("extracts multiple Facts across sentences", () => {
    const facts = extractor.extract("Zach reports to Alice. Zach knows Bob.");
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.predicate)).toEqual(["reports-to", "knows"]);
  });

  it("handles multi-word proper names", () => {
    const [fact] = extractor.extract("Mary Jane reports to John Smith.");
    expect(fact).toMatchObject({ subject: "Mary Jane", object: "John Smith" });
  });

  it("is deterministic and emits no Facts for unrecognized text", () => {
    expect(extractor.extract("the weather is nice today")).toEqual([]);
  });
});

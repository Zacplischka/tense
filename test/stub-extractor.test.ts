import { describe, expect, it } from "vitest";
import { StubExtractor } from "../src/extraction/stub.js";

const extractor = new StubExtractor();

describe("StubExtractor (pure, deterministic)", () => {
  it("extracts a single-valued reports-to Fact with null valid_at for prose", async () => {
    const { facts } = await extractor.extract("Zach reports to Alice.");
    expect(facts).toEqual([
      { subject: "Zach", predicate: "reports-to", object: "Alice", validAt: null, invalidAt: null },
    ]);
  });

  it("parses an explicit leading [YYYY-MM-DD] as valid_at", async () => {
    const { facts } = await extractor.extract("[2024-06-01] Zach reports to Bob.");
    expect(facts[0]?.validAt?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(facts[0]).toMatchObject({ subject: "Zach", predicate: "reports-to", object: "Bob" });
  });

  it("normalizes surface phrasings to canonical Predicate slugs", async () => {
    expect((await extractor.extract("Bob lives in Berlin.")).facts[0]?.predicate).toBe("lives-in");
    expect((await extractor.extract("Alice knows Carol.")).facts[0]?.predicate).toBe("knows");
    expect((await extractor.extract("Dana contributed to Tense.")).facts[0]?.predicate).toBe(
      "contributed-to",
    );
  });

  it("extracts multiple Facts across sentences and the entities they mention", async () => {
    const { facts, entities } = await extractor.extract("Zach reports to Alice. Zach knows Bob.");
    expect(facts.map((f) => f.predicate)).toEqual(["reports-to", "knows"]);
    expect(entities.map((e) => e.name).sort()).toEqual(["Alice", "Bob", "Zach"]);
  });

  it("handles multi-word proper names", async () => {
    const { facts } = await extractor.extract("Mary Jane reports to John Smith.");
    expect(facts[0]).toMatchObject({ subject: "Mary Jane", object: "John Smith" });
  });

  it("emits no Facts for unrecognized text", async () => {
    expect((await extractor.extract("the weather is nice today")).facts).toEqual([]);
  });
});

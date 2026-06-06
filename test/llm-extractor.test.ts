import { describe, expect, it } from "vitest";
import { LlmExtractor } from "../src/extraction/llm-extractor.js";
import { ExtractionError } from "../src/extraction/types.js";
import type { CompletionResult, ProviderClient } from "../src/provider/types.js";

/** A provider that returns a fixed completion string — no network. */
function fakeProvider(completion: string): ProviderClient {
  return {
    async complete(): Promise<CompletionResult> {
      return { text: completion, model: "fake" };
    },
    async embed(): Promise<number[][]> {
      return [];
    },
  };
}

describe("LlmExtractor", () => {
  it("parses well-formed structured output into entities and Facts", async () => {
    const provider = fakeProvider(
      JSON.stringify({
        entities: [{ name: "Zach" }, { name: "Bob" }],
        facts: [
          { subject: "Zach", predicate: "reports-to", object: "Bob", valid_at: "2024-06-01", invalid_at: null },
        ],
      }),
    );
    const { entities, facts } = await new LlmExtractor(provider).extract("...");

    expect(entities.map((e) => e.name)).toEqual(["Zach", "Bob"]);
    expect(facts[0]).toMatchObject({ subject: "Zach", predicate: "reports-to", object: "Bob" });
    expect(facts[0]?.validAt?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(facts[0]?.invalidAt).toBeNull();
  });

  it("leaves valid_at null when the model reports null (degenerate path)", async () => {
    const provider = fakeProvider(
      JSON.stringify({ facts: [{ subject: "Zach", predicate: "reports-to", object: "Bob", valid_at: null }] }),
    );
    const { facts } = await new LlmExtractor(provider).extract("Zach now reports to Bob.");
    expect(facts[0]?.validAt).toBeNull();
  });

  it("normalizes a free-text predicate to a hyphenated slug", async () => {
    const provider = fakeProvider(
      JSON.stringify({ facts: [{ subject: "A", predicate: "Reports To", object: "B" }] }),
    );
    const { facts } = await new LlmExtractor(provider).extract("...");
    expect(facts[0]?.predicate).toBe("reports-to");
  });

  it("tolerates a ```json fenced response", async () => {
    const provider = fakeProvider('```json\n{"entities":[{"name":"Zach"}],"facts":[]}\n```');
    const { entities } = await new LlmExtractor(provider).extract("...");
    expect(entities.map((e) => e.name)).toEqual(["Zach"]);
  });

  it("raises ExtractionError on non-JSON output (graceful failure)", async () => {
    const provider = fakeProvider("I'm sorry, I cannot do that.");
    await expect(new LlmExtractor(provider).extract("...")).rejects.toBeInstanceOf(ExtractionError);
  });

  it("raises ExtractionError when output fails schema validation", async () => {
    const provider = fakeProvider(JSON.stringify({ facts: [{ subject: "A", object: "B" }] })); // no predicate
    await expect(new LlmExtractor(provider).extract("...")).rejects.toBeInstanceOf(ExtractionError);
  });
});

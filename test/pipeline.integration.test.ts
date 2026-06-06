import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import type { Extractor } from "../src/extraction/types.js";
import type { ProviderClient } from "../src/provider/types.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });

const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  // no provider -> embeddings skipped (recall still works on keyword + temporal)
};
const store = deps.store;

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("remember pipeline (extract -> resolve -> supersede -> persist)", () => {
  it("ingests a Source and recalls the Fact with its Source", async () => {
    await remember(deps, "Zach reports to Alice.", "org-chart-q1");

    const facts = await recall({ store }, "Zach");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ subject: "Zach", predicate: "reports-to", object: "Alice", current: true });
    expect(facts[0]?.source.label).toBe("org-chart-q1");
  });

  it("org change end to end: two conflicting Sources close the prior Fact", async () => {
    await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
    const second = await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");

    expect(second.factsSuperseded.map((f) => f.object)).toEqual(["Alice"]);
    expect(second.factsSuperseded.map((f) => f.reason)).toEqual(["cardinality"]);
    expect(second.factsCreated.map((f) => f.object)).toEqual(["Bob"]);

    const current = await recall({ store }, "Zach");
    expect(current).toHaveLength(1);
    expect(current[0]?.object).toBe("Bob");

    // Expire, never delete.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM facts WHERE predicate='reports-to'");
    expect(rows[0].n).toBe(2);
  });

  it("resolves name variants to one subject (no fork) across Sources", async () => {
    await remember(deps, "Zachary reports to Alice.", "s1");
    await remember(deps, "Zach reports to Bob.", "s2"); // Zach fuzzy-resolves to Zachary

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM entities WHERE normalized_name IN ('zach','zachary')");
    expect(rows[0].n).toBe(1); // single subject Entity
    const current = await recall({ store }, "report");
    expect(current).toHaveLength(1);
    expect(current[0]?.object).toBe("Bob");
  });

  it("tags a cross-Predicate contradiction supersession with reason 'contradiction'", async () => {
    // The StubExtractor's grammar doesn't cover works-at/left; emit them directly.
    const crossPredicate: Extractor = {
      async extract(text: string) {
        const isLeft = /left/i.test(text);
        return {
          entities: [{ name: "Alice" }, { name: "Acme" }],
          facts: [
            {
              subject: "Alice",
              predicate: isLeft ? "left" : "works-at",
              object: "Acme",
              validAt: new Date(isLeft ? "2024-01-01T00:00:00Z" : "2020-01-01T00:00:00Z"),
              invalidAt: null,
            },
          ],
        };
      },
    };
    // A judge that nominates any candidate whose line mentions "Acme".
    const judge: ProviderClient = {
      async complete(req) {
        const text = (req.prompt ?? "") + (req.messages?.map((m) => m.content).join("\n") ?? "");
        const ids = [...text.matchAll(/id=([0-9a-f-]{36}):\s*(.+)/g)]
          .filter((m) => m[2]!.includes("Acme"))
          .map((m) => m[1]!);
        return { text: JSON.stringify({ contradicted_ids: ids }), model: "judge" };
      },
      async embed() {
        return [];
      },
    };

    const cdeps: RememberDeps = { ...deps, extractor: crossPredicate, provider: judge, enableContradiction: true };
    await remember(cdeps, "Alice works at Acme.");
    const left = await remember(cdeps, "Alice left Acme.");

    // The retired Fact's predicate ('works-at') differs from the one just stated
    // ('left') — the reason flag is what makes that legible.
    expect(left.factsSuperseded).toEqual([
      expect.objectContaining({ predicate: "works-at", object: "Acme", reason: "contradiction" }),
    ]);
  });

  it("surfaces extraction failure as an error without corrupting the graph", async () => {
    const failing: RememberDeps = {
      ...deps,
      extractor: {
        async extract() {
          throw new Error("bad LLM output");
        },
      },
    };
    await expect(remember(failing, "anything")).rejects.toThrow(/bad LLM output/);

    // No Source or Fact was written (extraction precedes the first write).
    const sources = await pool.query("SELECT count(*)::int AS n FROM sources");
    const facts = await pool.query("SELECT count(*)::int AS n FROM facts");
    expect(sources.rows[0].n).toBe(0);
    expect(facts.rows[0].n).toBe(0);
  });
});

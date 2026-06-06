import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { createMcpServer } from "../src/mcp/server.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";

/**
 * `min_reinforced` — recall only Facts confirmed by at least N Sources, a trust
 * threshold filtered in SQL (before the limit). Leverages the reinforcedBy
 * provenance signal end to end: ingest → fact_sources → recall.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};
const store = deps.store;

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
  // "knows Bob" asserted by two Sources (reinforcedBy 2); "knows Carol" by one.
  await remember(deps, "Zach knows Bob.", "s1");
  await remember(deps, "Zach knows Bob.", "s2");
  await remember(deps, "Zach knows Carol.", "s3");
});

afterAll(async () => {
  await pool.end();
});

describe("recall min_reinforced filter", () => {
  it("keeps only Facts confirmed by at least N Sources", async () => {
    const strong = await recall({ store }, "Zach", { minReinforced: 2 });
    expect(strong.map((f) => f.object)).toEqual(["Bob"]);
    expect(strong[0]?.reinforcedBy).toBe(2);
  });

  it("without the filter, both the single- and multiply-sourced Facts return", async () => {
    const all = await recall({ store }, "Zach");
    expect(all.map((f) => f.object).sort()).toEqual(["Bob", "Carol"]);
  });

  it("applies to the empty-query browse path too", async () => {
    const strong = await recall({ store }, "", { minReinforced: 2 });
    expect(strong.map((f) => f.object)).toEqual(["Bob"]);
  });

  it("a threshold no Fact meets yields an empty result", async () => {
    expect(await recall({ store }, "Zach", { minReinforced: 3 })).toEqual([]);
  });

  it("honors min_reinforced over MCP", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps).connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    const res: any = await client.callTool({
      name: "recall",
      arguments: { query: "Zach", min_reinforced: 2 },
    });
    expect(JSON.parse(res.content[0].text).map((f: any) => f.object)).toEqual(["Bob"]);
  });
});

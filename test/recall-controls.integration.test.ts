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
 * `recall` controls — the `predicate` filter and `limit` (exposed knobs added so
 * an agent can scope and cap retrieval). Keyword path (no provider); the filter
 * runs in SQL on the ranker so it composes with the temporal filter.
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
  await remember(deps, "Zach reports to Bob.", "r");
  await remember(deps, "Zach knows Carol.", "k1");
  await remember(deps, "Zach knows Dave.", "k2");
  await remember(deps, "Zach lives in Berlin.", "l");
});

afterAll(async () => {
  await pool.end();
});

describe("recall predicate filter", () => {
  it("restricts a query to a single Predicate", async () => {
    const knows = await recall({ store }, "Zach", { predicate: "knows" });
    expect(knows.every((f) => f.predicate === "knows")).toBe(true);
    expect(knows.map((f) => f.object).sort()).toEqual(["Carol", "Dave"]);
  });

  it("without a filter, recall spans all the subject's Predicates", async () => {
    const all = await recall({ store }, "Zach");
    expect(new Set(all.map((f) => f.predicate))).toEqual(
      new Set(["reports-to", "knows", "lives-in"]),
    );
  });

  it("normalizes the filter to the canonical slug ('Reports To' → reports-to)", async () => {
    const r = await recall({ store }, "Zach", { predicate: "Reports To" });
    expect(r.map((f) => f.object)).toEqual(["Bob"]);
  });

  it("applies to the empty-query browse path too", async () => {
    const knows = await recall({ store }, "", { predicate: "knows" });
    expect(knows.map((f) => f.object).sort()).toEqual(["Carol", "Dave"]);
  });
});

describe("recall limit", () => {
  it("caps the number of results", async () => {
    expect(await recall({ store }, "Zach", { limit: 1 })).toHaveLength(1);
    expect((await recall({ store }, "Zach", { limit: 2 })).length).toBeLessThanOrEqual(2);
  });
});

describe("recall controls over MCP", () => {
  it("honors predicate and limit args", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps).connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    const knows: any = await client.callTool({
      name: "recall",
      arguments: { query: "Zach", predicate: "knows" },
    });
    const knownFacts = JSON.parse(knows.content[0].text);
    expect(knownFacts.map((f: any) => f.object).sort()).toEqual(["Carol", "Dave"]);

    const capped: any = await client.callTool({
      name: "recall",
      arguments: { query: "Zach", limit: 1 },
    });
    expect(JSON.parse(capped.content[0].text)).toHaveLength(1);
  });
});

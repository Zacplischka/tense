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

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};
const store = deps.store;

/** Ingest the fixture: a supersession (reports-to) plus a multi-valued Fact (knows). */
async function seed(): Promise<void> {
  await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
  await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");
  await remember(deps, "Zach knows Carol.", "note");
}

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("graphStats (store)", () => {
  it("an empty graph reports all zeros and no predicates", async () => {
    const stats = await store.graphStats();
    expect(stats).toEqual({
      entities: 0,
      sources: 0,
      facts: { total: 0, current: 0, superseded: 0 },
      predicates: [],
    });
  });

  it("counts Entities, Sources, and splits Facts Current vs superseded", async () => {
    await seed();
    const stats = await store.graphStats();

    // Entities: Zach, Alice, Bob, Carol.
    expect(stats.entities).toBe(4);
    // Sources: q1, q2, note.
    expect(stats.sources).toBe(3);
    // Facts: reports-to Alice (superseded), reports-to Bob (current), knows Carol (current).
    expect(stats.facts).toEqual({ total: 3, current: 2, superseded: 1 });
    // Current + superseded always sum to total.
    expect(stats.facts.current + stats.facts.superseded).toBe(stats.facts.total);
  });

  it("breaks down per Predicate, ordered by total descending", async () => {
    await seed();
    const { predicates } = await store.graphStats();
    expect(predicates).toEqual([
      { predicate: "reports-to", current: 1, total: 2 },
      { predicate: "knows", current: 1, total: 1 },
    ]);
  });
});

describe("stats (MCP tool)", () => {
  it("returns the store snapshot, enriching each Predicate with its cardinality", async () => {
    await seed();
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("stats");

    const result: any = await client.callTool({ name: "stats", arguments: {} });
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    const storeStats = await store.graphStats();
    // Non-predicate fields round-trip the store snapshot exactly.
    expect(payload.entities).toBe(storeStats.entities);
    expect(payload.sources).toBe(storeStats.sources);
    expect(payload.facts).toEqual(storeStats.facts);
    // Predicates are the store's counts, each annotated with its registry
    // cardinality (the rule that governs supersession) — merged at the tool layer.
    expect(payload.predicates).toEqual([
      { predicate: "reports-to", current: 1, total: 2, cardinality: "single" },
      { predicate: "knows", current: 1, total: 1, cardinality: "multi" },
    ]);
  });
});

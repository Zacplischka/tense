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

/** Zach → Alice [2024-01-01] then Bob [2024-06-01] (supersedes), plus knows Carol. */
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

describe("listEntities (store)", () => {
  it("returns [] for an empty graph", async () => {
    expect(await store.listEntities()).toEqual([]);
  });

  it("counts Current Facts touching each Entity, most-connected first", async () => {
    await seed();
    const summaries = await store.listEntities();
    // Zach: reports-to Bob + knows Carol = 2 (reports-to Alice is superseded).
    // Bob: object of the Current reports-to = 1. Carol: object of knows = 1.
    // Alice: only the superseded Fact touches her = 0. Order: count desc, name asc.
    expect(summaries.map((e) => [e.name, e.currentFacts])).toEqual([
      ["Zach", 2],
      ["Bob", 1],
      ["Carol", 1],
      ["Alice", 0],
    ]);
  });

  it("lists each Entity's distinct Current-Fact Predicates (its relationship shape)", async () => {
    await seed();
    const byName = Object.fromEntries((await store.listEntities()).map((e) => [e.name, e.predicates]));
    expect(byName["Zach"]).toEqual(["knows", "reports-to"]); // sorted; reports-to Bob + knows Carol
    expect(byName["Bob"]).toEqual(["reports-to"]); // object of the Current reports-to
    expect(byName["Carol"]).toEqual(["knows"]);
    expect(byName["Alice"]).toEqual([]); // only a superseded Fact touches her
  });

  it("filters by a case-insensitive name substring", async () => {
    await seed();
    expect((await store.listEntities({ query: "al" })).map((e) => e.name)).toEqual(["Alice"]);
    // "o" matches Bob and Carol; tie on count (1) breaks by name.
    expect((await store.listEntities({ query: "o" })).map((e) => e.name)).toEqual(["Bob", "Carol"]);
  });
});

describe("entities (MCP tool)", () => {
  it("round-trips the store listing and honors the query arg", async () => {
    await seed();
    const client = await connect();

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("entities");

    const all: any = await client.callTool({ name: "entities", arguments: {} });
    expect(all.isError).toBeFalsy();
    expect(JSON.parse(all.content[0].text)).toEqual(await store.listEntities());

    const filtered: any = await client.callTool({ name: "entities", arguments: { query: "al" } });
    expect(JSON.parse(filtered.content[0].text)).toEqual([
      { id: expect.any(String), name: "Alice", currentFacts: 0, predicates: [] },
    ]);
  });
});

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
import type { RememberDeps } from "../src/pipeline.js";
import type { Extractor } from "../src/extraction/types.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });

function depsWith(extractor: Extractor): RememberDeps {
  return {
    store: new TemporalGraphStore(pool),
    extractor,
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
  };
}

async function connect(deps: RememberDeps): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function payload(result: any): any {
  return JSON.parse(result.content[0].text);
}

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("MCP adapter (real client <-> server, provider replayed)", () => {
  it("lists remember, recall, history, stats, entities, and sources", async () => {
    const client = await connect(depsWith(new StubExtractor()));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "entities",
      "history",
      "recall",
      "remember",
      "sources",
      "stats",
    ]);
  });

  it("org change over MCP: remember twice, recall returns the Current Fact", async () => {
    const client = await connect(depsWith(new StubExtractor()));

    await client.callTool({ name: "remember", arguments: { text: "[2024-01-01] Zach reports to Alice." } });
    const second = payload(
      await client.callTool({ name: "remember", arguments: { text: "[2024-06-01] Zach reports to Bob." } }),
    );
    expect(second.factsSuperseded.map((f: any) => f.object)).toEqual(["Alice"]);

    const recalled = payload(await client.callTool({ name: "recall", arguments: { query: "Zach" } }));
    expect(recalled).toHaveLength(1);
    expect(recalled[0]).toMatchObject({ object: "Bob", current: true });
    expect(recalled[0].source).toBeTruthy();
  });

  it("extraction failure returns an isError result and the server stays alive", async () => {
    const failing: Extractor = {
      async extract() {
        throw new Error("malformed model output");
      },
    };
    const client = await connect(depsWith(failing));

    const res: any = await client.callTool({ name: "remember", arguments: { text: "whatever" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/malformed model output/);

    // Server still responds afterward.
    const recalled = payload(await client.callTool({ name: "recall", arguments: { query: "" } }));
    expect(recalled).toEqual([]);
  });
});

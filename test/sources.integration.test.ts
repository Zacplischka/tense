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
const LONG = "x".repeat(250); // > 200 chars, no extractable predicate → 0 Facts

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
  await remember(deps, "Zach reports to Alice.", "s1"); // origin of the Alice Fact
  await remember(deps, "Zach reports to Bob.", "s2"); // supersedes Alice; origin of Bob Fact
  await remember(deps, "Zach reports to Bob.", "s3"); // reaffirms the Bob Fact
  await remember(deps, LONG, "doc"); // no Facts — newest
});

afterAll(async () => {
  await pool.end();
});

describe("listSources (store)", () => {
  it("lists Sources newest-first with their Fact-cite counts", async () => {
    const sources = await store.listSources();
    expect(sources.map((s) => s.label)).toEqual(["doc", "s3", "s2", "s1"]);
    const byLabel = Object.fromEntries(sources.map((s) => [s.label, s.facts]));
    expect(byLabel).toEqual({ doc: 0, s3: 1, s2: 1, s1: 1 });
  });

  it("previews long Source text and returns short text intact", async () => {
    const sources = await store.listSources();
    const doc = sources.find((s) => s.label === "doc")!;
    expect(doc.preview).toBe("x".repeat(200) + "…");
    const s1 = sources.find((s) => s.label === "s1")!;
    expect(s1.preview).toBe("Zach reports to Alice.");
  });

  it("respects the limit", async () => {
    expect(await store.listSources({ limit: 2 })).toHaveLength(2);
  });
});

describe("sources (MCP tool)", () => {
  it("round-trips the listing", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps).connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("sources");

    const res: any = await client.callTool({ name: "sources", arguments: {} });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload[0].label).toBe("doc");
    expect(payload.find((s: any) => s.label === "s2").facts).toBe(1);
  });
});

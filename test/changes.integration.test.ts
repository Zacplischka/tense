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

/**
 * `changes` — the transaction-time change feed (Facts learned or retired since an
 * instant). Asserted by robust properties (membership, the filter invariant on
 * returned rows, descending change-time order) rather than brittle timestamp
 * arithmetic, since `created_at` is the DB wall-clock.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};
const store = deps.store;
const EPOCH = new Date(0);
const changeTime = (f: { learnedAt: Date; retiredAt: Date | null }) =>
  Math.max(f.learnedAt.getTime(), f.retiredAt?.getTime() ?? 0);

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
  await remember(deps, "Zach knows Alice.", "s1");
  await remember(deps, "Zach knows Bob.", "s2");
  await remember(deps, "[2024-01-01] Zach reports to Carol.", "s3");
  await remember(deps, "[2024-06-01] Zach reports to Dave.", "s4"); // supersedes Carol
});

afterAll(async () => {
  await pool.end();
});

describe("changesSince (transaction-time feed)", () => {
  it("from the epoch, returns every Fact, newest change first", async () => {
    const all = await store.changesSince(EPOCH);
    expect(all.map((f) => f.object).sort()).toEqual(["Alice", "Bob", "Carol", "Dave"]);
    const keys = all.map(changeTime);
    expect(keys).toEqual([...keys].sort((a, b) => b - a)); // descending
  });

  it("distinguishes learned (Current) from retired Facts via learnedAt/retiredAt", async () => {
    const all = await store.changesSince(EPOCH);
    const carol = all.find((f) => f.object === "Carol")!;
    expect(carol.current).toBe(false);
    expect(carol.retiredAt).not.toBeNull(); // retired in the window
    const dave = all.find((f) => f.object === "Dave")!;
    expect(dave.current).toBe(true);
    expect(dave.retiredAt).toBeNull(); // still Current
    expect(dave.learnedAt).toBeInstanceOf(Date);
  });

  it("returns nothing for a future `since`", async () => {
    expect(await store.changesSince(new Date(Date.now() + 24 * 3600 * 1000))).toEqual([]);
  });

  it("only returns Facts changed at/after the `since` boundary", async () => {
    const all = await store.changesSince(EPOCH);
    const since = new Date(Math.max(...all.map(changeTime))); // the latest change instant
    const recent = await store.changesSince(since);
    expect(recent.length).toBeGreaterThan(0);
    for (const f of recent) expect(changeTime(f)).toBeGreaterThanOrEqual(since.getTime());
  });
});

describe("changes (MCP tool)", () => {
  it("round-trips the feed and rejects an invalid date", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps).connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    const ok: any = await client.callTool({ name: "changes", arguments: { since: EPOCH.toISOString() } });
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(ok.content[0].text).map((f: any) => f.object).sort()).toEqual([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ]);

    const bad: any = await client.callTool({ name: "changes", arguments: { since: "not-a-date" } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/invalid since date/);
  });
});

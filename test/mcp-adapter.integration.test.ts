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
  it("lists remember, preview, recall, history, stats, entities, and sources", async () => {
    const client = await connect(depsWith(new StubExtractor()));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "changes",
      "entities",
      "history",
      "preview",
      "recall",
      "remember",
      "sources",
      "stats",
    ]);
  });

  it("annotates the read tools read-only and remember as non-destructive write", async () => {
    const client = await connect(depsWith(new StubExtractor()));
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    for (const ro of ["preview", "recall", "history", "stats", "entities", "sources", "changes"]) {
      expect(byName[ro]?.readOnlyHint).toBe(true);
    }
    // remember writes, but Tense never deletes — advertise that explicitly.
    expect(byName["remember"]?.readOnlyHint).toBe(false);
    expect(byName["remember"]?.destructiveHint).toBe(false);
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

  it("point-in-time recall crosses the MCP wire: as_of returns who was Current then, not now", async () => {
    // The project's headline behavior — recall(as_of=…) — exercised end-to-end over
    // the real MCP boundary, not just the recall() unit. This is the exact call the
    // README's flagship Inspector command makes (`--tool-arg 'as_of=2024-03-01'`):
    // the temporal filter, the supersession, AND the as_of arg all have to survive
    // the snake_case JSON wire for an agent to get the historically-correct answer.
    const client = await connect(depsWith(new StubExtractor()));

    await client.callTool({ name: "remember", arguments: { text: "[2024-01-01] Zach reports to Alice." } });
    await client.callTool({ name: "remember", arguments: { text: "[2024-06-01] Zach reports to Bob." } });

    // Live recall returns the Current Fact — Bob.
    const now = payload(await client.callTool({ name: "recall", arguments: { query: "Zach reports to" } }));
    expect(now.map((f: any) => f.object)).toEqual(["Bob"]);

    // recall(as_of="2024-03-01") returns who was Current THEN — Alice — closed off
    // at the moment Bob took over. A recency-sorted vector store cannot do this; it
    // is the win the eval scores and the demo shows, now locked on the MCP wire the
    // agent actually calls. The validity interval crosses the wire as ISO strings.
    const then = payload(
      await client.callTool({ name: "recall", arguments: { query: "Zach reports to", as_of: "2024-03-01" } }),
    );
    expect(then).toHaveLength(1);
    expect(then[0]).toMatchObject({ object: "Alice", current: false });
    expect(then[0].validAt).toBe("2024-01-01T00:00:00.000Z");
    expect(then[0].invalidAt).toBe("2024-06-01T00:00:00.000Z");
  });

  it("carries the agent-facing signals across the JSON boundary (reason, learnedAt, history retiredAt)", async () => {
    const client = await connect(depsWith(new StubExtractor()));

    await client.callTool({ name: "remember", arguments: { text: "[2024-01-01] Zach reports to Alice." } });
    const second = payload(
      await client.callTool({ name: "remember", arguments: { text: "[2024-06-01] Zach reports to Bob." } }),
    );
    // `remember` tags WHY each Fact was retired — and it survives serialization.
    expect(second.factsSuperseded).toEqual([
      expect.objectContaining({ object: "Alice", reason: "cardinality" }),
    ]);

    const recalled = payload(await client.callTool({ name: "recall", arguments: { query: "Zach reports to" } }));
    // `learnedAt` (transaction time) crosses the wire as an ISO date string.
    const learned = recalled[0].learnedAt;
    expect(typeof learned).toBe("string");
    expect(Number.isNaN(Date.parse(learned))).toBe(false);

    // First end-to-end exercise of the `history` tool over MCP: the chain crosses
    // the wire, and each link's transaction-time retirement (retiredAt) serializes
    // — a closed Fact carries an ISO date, the Current one is null.
    const chain = payload(await client.callTool({ name: "history", arguments: { entity: "Zach", predicate: "reports-to" } }));
    expect(chain.map((f: any) => f.object)).toEqual(["Alice", "Bob"]);
    expect(typeof chain[0].retiredAt).toBe("string");
    expect(Number.isNaN(Date.parse(chain[0].retiredAt))).toBe(false);
    expect(chain[1].retiredAt).toBeNull();
  });

  it("threads include_sources / include_source_text across the MCP boundary (provenance opt-in, token-lean opt-out)", async () => {
    // recall()'s differentiating controls are unit-tested directly, but the MCP
    // adapter rewires them snake_case -> camelCase by hand; this locks that wiring
    // so a transposed flag (e.g. includeSources <- include_source_text) is caught.
    const client = await connect(depsWith(new StubExtractor()));
    // "Zach knows Bob" asserted twice (knows is multi-valued) — a Reaffirmation, so
    // the one Fact ends up cited by two Sources.
    await client.callTool({ name: "remember", arguments: { text: "Zach knows Bob.", source: "s1" } });
    await client.callTool({ name: "remember", arguments: { text: "Zach knows Bob.", source: "s2" } });

    // Default: the lean common path — full Source text, no citedBy list.
    const def = payload(await client.callTool({ name: "recall", arguments: { query: "Zach knows" } }));
    expect(def[0].source.text).toBeTruthy();
    expect(def[0].citedBy).toBeUndefined();

    // include_sources: true attaches WHICH Sources assert each Fact, across the wire.
    const withSources = payload(
      await client.callTool({ name: "recall", arguments: { query: "Zach knows", include_sources: true } }),
    );
    const bob = withSources.find((f: any) => f.object === "Bob");
    expect(bob.citedBy.map((s: any) => s.label).sort()).toEqual(["s1", "s2"]);

    // include_source_text: false drops the Source text (id/label only) — token-lean.
    const lean = payload(
      await client.callTool({ name: "recall", arguments: { query: "Zach knows", include_source_text: false } }),
    );
    expect(lean[0].source.text).toBeUndefined();
    expect(lean[0].source.label).toBeTruthy();
  });

  it("stats tags each Predicate with its cardinality (single supersedes, multi accumulates)", async () => {
    const client = await connect(depsWith(new StubExtractor()));
    await client.callTool({ name: "remember", arguments: { text: "Zach reports to Alice." } });
    await client.callTool({ name: "remember", arguments: { text: "Zach knows Carol." } });

    const stats = payload(await client.callTool({ name: "stats", arguments: {} }));
    const byPredicate = Object.fromEntries(stats.predicates.map((p: any) => [p.predicate, p.cardinality]));
    expect(byPredicate["reports-to"]).toBe("single"); // a new value supersedes the prior
    expect(byPredicate["knows"]).toBe("multi"); // values accumulate
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

  it("a read-path store failure returns an isError result and the server stays alive", async () => {
    // The module contract: errors are returned as isError results, never thrown —
    // so a transient store/DB fault degrades one call, not the whole server. The
    // write path proves this above; this locks the same guard for the read tools.
    const deps = depsWith(new StubExtractor());
    deps.store.rankByKeyword = async () => {
      throw new Error("connection terminated unexpectedly");
    };
    deps.resolver.resolve = async () => {
      throw new Error("connection terminated unexpectedly");
    };
    const client = await connect(deps);

    const recallRes: any = await client.callTool({ name: "recall", arguments: { query: "Zach" } });
    expect(recallRes.isError).toBe(true);
    expect(recallRes.content[0].text).toMatch(/recall failed: connection terminated/);

    const historyRes: any = await client.callTool({ name: "history", arguments: { entity: "Zach" } });
    expect(historyRes.isError).toBe(true);
    expect(historyRes.content[0].text).toMatch(/history failed: connection terminated/);

    // The server is unharmed: a tool whose store call is healthy still answers.
    const stats = payload(await client.callTool({ name: "stats", arguments: {} }));
    expect(stats.facts).toMatchObject({ total: 0 });
  });

  it("rejects a malformed as_of before it reaches the store, with a message naming the bad value", async () => {
    // The adapter parses as_of into a Date and guards Number.isNaN BEFORE calling
    // recall — so a garbled agent date ("last Tuesday") returns a clear isError, not
    // an `Invalid Date` that silently slips into the SQL temporal filter. Untested
    // until now: this locks that the guard fires and echoes the offending value.
    const client = await connect(depsWith(new StubExtractor()));

    const res: any = await client.callTool({
      name: "recall",
      arguments: { query: "Zach", as_of: "last Tuesday" },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("invalid as_of date: last Tuesday");

    // A well-formed as_of on the same client still works — the guard rejects bad
    // input, it doesn't wedge the tool.
    const ok = payload(await client.callTool({ name: "recall", arguments: { query: "", as_of: "2024-03-01" } }));
    expect(Array.isArray(ok)).toBe(true);
  });

  it("rejects a malformed changes `since` the same way", async () => {
    // `changes` applies the identical NaN-date guard to `since`; lock it too so an
    // incremental-sync caller gets a named error instead of a silent empty feed.
    const client = await connect(depsWith(new StubExtractor()));

    const res: any = await client.callTool({ name: "changes", arguments: { since: "yesterday" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("invalid since date: yesterday");

    // Server stays alive: a valid `since` returns a (here empty) feed.
    const ok = payload(await client.callTool({ name: "changes", arguments: { since: "1970-01-01" } }));
    expect(Array.isArray(ok)).toBe(true);
  });
});

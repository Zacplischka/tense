import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import { history } from "../src/retrieval/history.js";

/**
 * `reinforcedBy` on recalled Facts — the provenance-strength signal (ADR 0005).
 * The graph already tracks how many Sources assert a Fact (fact_sources); these
 * tests prove the read path now surfaces it so an agent can weigh a multiply-
 * confirmed Fact above a single mention.
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
  // "Zach knows Bob" asserted twice (reaffirmed); "Zach knows Carol" once.
  await remember(deps, "Zach knows Bob.", "s1");
  await remember(deps, "Zach knows Bob.", "s2");
  await remember(deps, "Zach knows Carol.", "s3");
});

afterAll(async () => {
  await pool.end();
});

describe("recall surfaces provenance strength (reinforcedBy)", () => {
  it("counts every Source that asserts a Fact, not just the origin", async () => {
    const facts = await recall({ store }, "Zach knows");
    const bob = facts.find((f) => f.object === "Bob");
    const carol = facts.find((f) => f.object === "Carol");
    expect(bob?.reinforcedBy).toBe(2); // s1 + s2
    expect(carol?.reinforcedBy).toBe(1); // s3 only
  });

  it("the empty-query browse path carries reinforcedBy too", async () => {
    const all = await recall({ store }, "");
    expect(all.find((f) => f.object === "Bob")?.reinforcedBy).toBe(2);
  });

  it("history exposes reinforcedBy on each Fact in the chain", async () => {
    const chain = await history({ store, resolver: deps.resolver }, "Zach", "knows");
    expect(chain.find((f) => f.object === "Bob")?.reinforcedBy).toBe(2);
    expect(chain.find((f) => f.object === "Carol")?.reinforcedBy).toBe(1);
  });
});

describe("recall include_sources (citedBy provenance detail)", () => {
  it("attaches WHICH Sources assert each Fact on opt-in (origin + reaffirmations)", async () => {
    const facts = await recall({ store }, "Zach knows", { includeSources: true });
    const bob = facts.find((f) => f.object === "Bob");
    const carol = facts.find((f) => f.object === "Carol");
    expect(bob?.citedBy?.map((s) => s.label).sort()).toEqual(["s1", "s2"]);
    expect(carol?.citedBy?.map((s) => s.label)).toEqual(["s3"]);
    // The detail is exactly the provenance behind the count.
    expect(bob?.citedBy?.length).toBe(bob?.reinforcedBy);
  });

  it("omits citedBy by default, keeping the common path lean", async () => {
    const [fact] = await recall({ store }, "Zach knows");
    expect(fact?.citedBy).toBeUndefined();
  });

  it("attaches citedBy on the empty-query browse path too", async () => {
    const all = await recall({ store }, "", { includeSources: true });
    expect(all.find((f) => f.object === "Bob")?.citedBy?.length).toBe(2);
  });
});

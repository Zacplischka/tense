import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { history } from "../src/retrieval/history.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("history (supersession chain)", () => {
  it("returns [closed Fact, Current Fact] in chronological order after an org change", async () => {
    await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
    await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");

    const chain = await history({ store: deps.store, resolver: deps.resolver }, "Zach", "reports-to");

    expect(chain.map((f) => f.object)).toEqual(["Alice", "Bob"]); // earliest valid_at first
    expect(chain[0]).toMatchObject({ object: "Alice", current: false });
    expect(chain[0]?.invalidAt?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(chain[1]).toMatchObject({ object: "Bob", current: true });
    // Each carries its Source.
    expect(chain[0]?.source.label).toBe("q1");
    expect(chain[1]?.source.label).toBe("q2");
  });

  it("narrows to a single Predicate when given one", async () => {
    await remember(deps, "Zach reports to Alice. Zach knows Carol.", "s1");
    const reportsTo = await history({ store: deps.store, resolver: deps.resolver }, "Zach", "reports-to");
    expect(reportsTo.every((f) => f.predicate === "reports-to")).toBe(true);

    const all = await history({ store: deps.store, resolver: deps.resolver }, "Zach");
    expect(all.map((f) => f.predicate).sort()).toEqual(["knows", "reports-to"]);
  });

  it("resolves subject name variants and returns [] for an unknown subject", async () => {
    await remember(deps, "Zachary reports to Alice.", "s1");
    const viaVariant = await history({ store: deps.store, resolver: deps.resolver }, "Zach", "reports-to");
    expect(viaVariant.map((f) => f.object)).toEqual(["Alice"]);

    const unknown = await history({ store: deps.store, resolver: deps.resolver }, "Nobody");
    expect(unknown).toEqual([]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};
const store = deps.store;

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
  // Fixed oracle: Zach reports to Alice [2024-01-01], then Bob [2024-06-01].
  await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
  await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");
});

afterAll(async () => {
  await pool.end();
});

describe("recall (point-in-time)", () => {
  it("defaults to Current Facts only (Bob, not the superseded Alice)", async () => {
    const facts = await recall({ store }, "Zach reports to");
    const reportsTo = facts.filter((f) => f.predicate === "reports-to");
    expect(reportsTo).toHaveLength(1);
    expect(reportsTo[0]?.object).toBe("Bob");
    expect(reportsTo[0]?.current).toBe(true);
  });

  it("as_of before the change returns the historically-correct Fact (Alice)", async () => {
    const facts = await recall({ store }, "Zach reports to", { asOf: new Date("2024-03-01T00:00:00Z") });
    expect(facts.map((f) => f.object)).toEqual(["Alice"]);
  });

  it("as_of after the change returns the later Fact (Bob)", async () => {
    const facts = await recall({ store }, "Zach reports to", { asOf: new Date("2024-09-01T00:00:00Z") });
    expect(facts.map((f) => f.object)).toEqual(["Bob"]);
  });

  it("every returned Fact carries its Source citation and validity interval", async () => {
    const [fact] = await recall({ store }, "Zach reports to");
    expect(fact?.source.label).toBeTruthy();
    expect(fact?.source.text).toContain("Zach reports to Bob");
    expect(fact?.validAt?.toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(fact?.invalidAt).toBeNull(); // Current Fact has an open valid interval
  });

  it("include_source_text: false drops the full text but keeps the Source id/label", async () => {
    const [full] = await recall({ store }, "Zach reports to");
    expect(full?.source.text).toBeTruthy(); // default: full text present

    const [lean] = await recall({ store }, "Zach reports to", { includeSourceText: false });
    expect(lean?.source.text).toBeUndefined(); // omitted for a token-lean result
    expect(lean?.source.id).toBe(full?.source.id); // citation still identifiable
    expect(lean?.source.label).toBe(full?.source.label);
  });

  it("surfaces learnedAt (transaction time), distinct from valid time and consistent with `changes`", async () => {
    const [bob] = await recall({ store }, "Zach reports to");
    expect(bob?.learnedAt).toBeInstanceOf(Date);
    // Transaction time (when the system learned it, ~now) is the OTHER bi-temporal
    // axis — here clearly later than valid time (true in the world since 2024-06-01).
    expect(bob!.learnedAt.getTime()).toBeGreaterThan(bob!.validAt!.getTime());
    // The same Fact's learnedAt agrees across the valid-time (recall) and the
    // transaction-time (changes) lenses — both read the one created_at.
    const changes = await store.changesSince(new Date("2000-01-01T00:00:00Z"));
    const bobChange = changes.find((c) => c.id === bob!.id);
    expect(bobChange?.learnedAt.toISOString()).toBe(bob!.learnedAt.toISOString());
  });

  it("empty query browses the temporally-filtered set", async () => {
    const current = await recall({ store }, "");
    expect(current.every((f) => f.current)).toBe(true);

    const asOf = await recall({ store }, "", { asOf: new Date("2024-03-01T00:00:00Z") });
    expect(asOf.map((f) => f.object)).toEqual(["Alice"]);
  });
});

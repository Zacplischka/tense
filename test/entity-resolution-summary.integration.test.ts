import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";

/**
 * `remember` now reports how each name resolved (entitiesResolved): new / exact /
 * fuzzy. Surfaces fuzzy merges so a wrong merge is visible rather than silent.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("remember entitiesResolved", () => {
  it("reports newly-created Entities as 'new' (no similarity)", async () => {
    const s = await remember(deps, "Zach reports to Alice.", "s1");
    const byInput = Object.fromEntries(s.entitiesResolved.map((e) => [e.input, e]));
    expect(byInput["Zach"]).toMatchObject({ resolvedTo: "Zach", reason: "new" });
    expect(byInput["Alice"]).toMatchObject({ resolvedTo: "Alice", reason: "new" });
    expect(byInput["Zach"]?.similarity).toBeUndefined();
  });

  it("reports an exact re-mention as 'exact'", async () => {
    await remember(deps, "Zach reports to Alice.", "s1");
    const s = await remember(deps, "Zach knows Carol.", "s2");
    const byInput = Object.fromEntries(s.entitiesResolved.map((e) => [e.input, e]));
    expect(byInput["Zach"]).toMatchObject({ resolvedTo: "Zach", reason: "exact" });
    expect(byInput["Carol"]).toMatchObject({ reason: "new" });
  });

  it("reports a variant as 'fuzzy', naming the Entity it merged into + similarity", async () => {
    await remember(deps, "Zachary reports to Alice.", "s1");
    const s = await remember(deps, "Zachery reports to Bob.", "s2"); // typo → Zachary

    const zachery = s.entitiesResolved.find((e) => e.input === "Zachery")!;
    expect(zachery.reason).toBe("fuzzy");
    expect(zachery.resolvedTo).toBe("Zachary");
    expect(typeof zachery.similarity).toBe("number");
    expect(zachery.similarity!).toBeGreaterThan(0);

    // The merge really happened: one Zachary Entity, and the reports-to Fact moved.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM entities WHERE normalized_name = 'zachary'");
    expect(rows[0].n).toBe(1);
    expect(s.factsSuperseded.map((f) => f.object)).toEqual(["Alice"]);
    expect(s.factsCreated.map((f) => f.object)).toEqual(["Bob"]);
  });

  it("records each distinct input name once, even across multiple Facts", async () => {
    // Alice is the object of fact 1 and the subject of fact 2 → one entry.
    const s = await remember(deps, "Zach reports to Alice. Alice knows Bob.", "s1");
    const inputs = s.entitiesResolved.map((e) => e.input).sort();
    expect(inputs).toEqual(["Alice", "Bob", "Zach"]);
  });
});

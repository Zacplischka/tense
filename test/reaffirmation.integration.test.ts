import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";

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
});

afterAll(async () => {
  await pool.end();
});

describe("reaffirmation (ADR 0005: a Fact may cite multiple Sources)", () => {
  it("re-stating an already-Current Fact appends provenance, not a duplicate", async () => {
    const first = await remember(deps, "Zach knows Bob.", "s1");
    expect(first.factsCreated).toHaveLength(1);
    expect(first.factsReaffirmed).toHaveLength(0);
    const factId = first.factsCreated[0]!.id;
    expect(await store.countFactSources(factId)).toBe(1); // origin Source recorded

    const second = await remember(deps, "Zach knows Bob.", "s2");
    expect(second.factsCreated).toHaveLength(0);
    expect(second.factsReaffirmed).toHaveLength(1);
    expect(second.factsReaffirmed[0]!.id).toBe(factId); // same Fact, unchanged

    const facts = await pool.query("SELECT count(*)::int AS n FROM facts");
    expect(facts.rows[0].n).toBe(1); // exactly one Fact
    expect(await store.countFactSources(factId)).toBe(2); // two Sources asserted it
  });

  it("re-stating the SAME single-valued value reaffirms — no self-supersession churn", async () => {
    await remember(deps, "Zach reports to Alice.", "a1");
    const again = await remember(deps, "Zach reports to Alice.", "a2");

    expect(again.factsReaffirmed).toHaveLength(1);
    expect(again.factsSuperseded).toHaveLength(0);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM facts WHERE predicate = 'reports-to'",
    );
    expect(rows[0].n).toBe(1); // no churn — still a single Fact
  });

  it("a DIFFERENT value on a single-valued Predicate still supersedes, never reaffirms", async () => {
    await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
    const second = await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");

    expect(second.factsReaffirmed).toHaveLength(0);
    expect(second.factsSuperseded.map((f) => f.object)).toEqual(["Alice"]);
    expect(second.factsCreated.map((f) => f.object)).toEqual(["Bob"]);
  });
});

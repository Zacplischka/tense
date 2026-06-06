import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { previewRemember } from "../src/preview.js";

/**
 * `preview` (dry-run remember): reports what ingest WOULD do without writing, and
 * agrees with `remember` by construction (shared pure supersession resolver).
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
};
const store = deps.store;
const objects = (facts: { object: string }[]) => facts.map((f) => f.object).sort();

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("previewRemember", () => {
  it("on an empty graph, reports would-create and resolves names — writing nothing", async () => {
    const p = await previewRemember(deps, "Zach knows Carol.");
    expect(objects(p.factsToCreate)).toEqual(["Carol"]);
    expect(p.factsToSupersede).toEqual([]);
    expect(p.factsToReaffirm).toEqual([]);
    expect(p.entitiesResolved.map((e) => `${e.input}:${e.reason}`).sort()).toEqual(["Carol:new", "Zach:new"]);

    // Read-only: nothing was written.
    expect(await store.graphStats()).toMatchObject({ entities: 0, sources: 0, facts: { total: 0 } });
  });

  it("predicts a supersession WITHOUT writing, then remember matches the prediction", async () => {
    await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
    const before = await store.graphStats();

    const p = await previewRemember(deps, "[2024-06-01] Zach reports to Bob.");
    expect(objects(p.factsToCreate)).toEqual(["Bob"]);
    expect(objects(p.factsToSupersede)).toEqual(["Alice"]);
    expect(p.factsToReaffirm).toEqual([]);
    expect(p.entitiesResolved.find((e) => e.input === "Zach")?.reason).toBe("exact");
    expect(p.entitiesResolved.find((e) => e.input === "Bob")?.reason).toBe("new");

    // Preview wrote nothing: graph identical to before (Bob not created).
    expect(await store.graphStats()).toEqual(before);

    // Now actually remember it — the real summary matches what preview predicted.
    const summary = await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");
    expect(objects(summary.factsCreated)).toEqual(objects(p.factsToCreate));
    expect(objects(summary.factsSuperseded)).toEqual(objects(p.factsToSupersede));
  });

  it("predicts a reaffirmation (existing Current Fact, same value)", async () => {
    await remember(deps, "Zach knows Bob.", "s1");
    const before = await store.graphStats();

    const p = await previewRemember(deps, "Zach knows Bob.");
    expect(objects(p.factsToReaffirm)).toEqual(["Bob"]);
    expect(p.factsToCreate).toEqual([]);
    expect(p.factsToSupersede).toEqual([]);
    expect(await store.graphStats()).toEqual(before); // still read-only
  });
});

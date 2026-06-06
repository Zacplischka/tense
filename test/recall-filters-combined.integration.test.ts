import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import { BagOfWordsProvider } from "./helpers/bag-of-words-provider.js";

/**
 * recall with its filters COMBINED (as_of + predicate + min_reinforced). Each is
 * tested in isolation elsewhere; this locks down the combination, which is where
 * the rankers' hand-built `$n` param indexing (3 optional clauses × 3 rankers)
 * could silently drift. Runs WITH a provider so the semantic ranker is live too —
 * so all three paths (keyword, semantic, empty-query browse) are exercised.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const provider = new BagOfWordsProvider();
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  provider, // embeddings stored on remember → semantic ranker active on recall
};
const store = deps.store;
const objs = (facts: { object: string }[]) => facts.map((f) => f.object).sort();

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
  await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1"); // reports-to Alice (valid 2024-01..06)
  await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2"); // supersedes Alice; Bob current
  await remember(deps, "Zach knows Carol.", "k1"); // knows Carol
  await remember(deps, "Zach knows Carol.", "k2"); // reaffirm → Carol reinforcedBy 2
  await remember(deps, "Zach knows Dave.", "k3"); // knows Dave, reinforcedBy 1
});

afterAll(async () => {
  await pool.end();
});

describe("recall combined filters (keyword + semantic rankers)", () => {
  it("predicate + min_reinforced together", async () => {
    const r = await recall({ store, provider }, "Zach", { predicate: "knows", minReinforced: 2 });
    expect(objs(r)).toEqual(["Carol"]); // Dave (1 source) and reports-to (predicate) excluded
  });

  it("predicate + as_of together (point-in-time, scoped)", async () => {
    const r = await recall({ store, provider }, "Zach", { predicate: "reports-to", asOf: new Date("2024-03-01T00:00:00Z") });
    expect(objs(r)).toEqual(["Alice"]); // Bob not yet valid; knows excluded by predicate
  });

  it("all three at once — and as_of still excludes null-valid Facts", async () => {
    // knows Facts have no valid_at, so as_of filters them out even though they
    // satisfy predicate=knows and min_reinforced=2.
    const r = await recall({ store, provider }, "Zach", {
      predicate: "knows",
      asOf: new Date("2024-03-01T00:00:00Z"),
      minReinforced: 2,
    });
    expect(r).toEqual([]);
  });
});

describe("recall combined filters (empty-query browse / recallByTemporal)", () => {
  it("predicate + min_reinforced on the browse path", async () => {
    const r = await recall({ store, provider }, "", { predicate: "knows", minReinforced: 2 });
    expect(objs(r)).toEqual(["Carol"]);
  });
});

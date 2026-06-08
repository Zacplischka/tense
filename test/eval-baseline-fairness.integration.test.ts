import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import { baselineAnswer } from "../eval/baseline.js";
import { BagOfWordsProvider } from "../eval/bag-of-words-provider.js";

/**
 * Locks the fairness of the headline comparison (Tense vs the fair vector
 * baseline). The whole "point-in-time: 100% vs 0%, and 0% is honest, not rigged"
 * claim rests on ONE property of `store.baselineCandidates`: it pools superseded
 * AND Current Facts, so the baseline literally has the historically-correct answer
 * in its candidate set. Its point-in-time miss is therefore a ranking choice
 * (recency picks the most-recent Fact) — not structural blindness to the old one.
 *
 * If a future change ever filtered the baseline's pool to Current-only, the
 * baseline would lose by construction (it could never see the old Fact) and the
 * "fair baseline" claim would quietly become a strawman. This test fails loudly
 * if that happens.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const provider = new BagOfWordsProvider();
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  provider, // deterministic embeddings, written on remember
};
const store = deps.store;

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
  // Zach reports to Alice [2024-01-01], then Bob [2024-06-01] supersedes her
  // (reports-to is single-valued → cardinality supersession). Alice is now closed.
  await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
  await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");
});

afterAll(async () => {
  await pool.end();
});

describe("fair vector baseline — superseded Facts stay eligible", () => {
  it("Alice is superseded (closed), Bob is Current — the supersession actually happened", async () => {
    const facts = await store.allFacts();
    const alice = facts.find((f) => f.object === "Alice");
    const bob = facts.find((f) => f.object === "Bob");
    expect(alice?.current).toBe(false); // closed, not deleted
    expect(bob?.current).toBe(true);
  });

  it("the baseline's candidate pool contains the superseded Fact, not just the Current one", async () => {
    const [embedding] = await provider.embed(["who does Zach report to"]);
    const candidates = await store.baselineCandidates(embedding!, 5);
    const objects = candidates.map((c) => c.object);
    // The historically-correct answer (Alice) is in front of the baseline...
    expect(objects).toContain("Alice");
    // ...alongside the most-recent one (Bob). It sees BOTH.
    expect(objects).toContain("Bob");
  });

  it("baseline returns the most-recent Fact (Bob) — an honest ranking miss, not blindness", async () => {
    // It had Alice in its pool (asserted above) but its recency tiebreak prefers
    // Bob. For a past `as_of` the gold answer is Alice, so this is exactly where
    // the baseline loses — having seen the right Fact and ranked it second.
    const answer = await baselineAnswer(store, provider, "who does Zach report to");
    expect(answer).toBe("Bob");
  });

  it("Tense, asked point-in-time, returns Alice from the SAME graph the baseline ranked Bob from", async () => {
    // Same data, same embeddings — the only difference is the bi-temporal filter.
    // This is the headline win isolated to one mechanism: the temporal model.
    const asOf = new Date("2024-03-01T00:00:00Z");
    const [top] = await recall({ store, provider }, "who does Zach report to", { asOf });
    expect(top?.object).toBe("Alice");
    expect(top?.current).toBe(false);
  });
});

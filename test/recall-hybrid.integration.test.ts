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
 * Hybrid recall through `recall()` WITH a provider — the path the other recall
 * tests skip (they run provider-less, keyword-only). A deterministic embedding
 * double (BagOfWordsProvider) makes the semantic ranker live without a network
 * call, so this pins the project's headline mechanism: filter-then-fuse, where
 * the temporal filter runs in SQL on BOTH rankers before RRF, so a superseded
 * Fact never enters the ranking even when it is the closest match.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const provider = new BagOfWordsProvider();
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  provider, // embeddings written on remember; semantic ranker live on recall
};
const store = deps.store;

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
  // Zach reports to Alice [2024-01-01], then Bob [2024-06-01] supersedes her.
  await remember(deps, "[2024-01-01] Zach reports to Alice.", "q1");
  await remember(deps, "[2024-06-01] Zach reports to Bob.", "q2");
});

afterAll(async () => {
  await pool.end();
});

describe("hybrid recall (semantic + keyword, filter-then-fuse)", () => {
  it("ingest stores an embedding, so the semantic ranker has candidates", async () => {
    const [bob] = await recall({ store, provider }, "Zach reports to");
    expect(bob?.object).toBe("Bob");
    expect(await store.hasEmbedding(bob!.id)).toBe(true);
  });

  it("returns the Current Fact via the semantic ranker even when keyword misses it", async () => {
    // Query names "Alice" — keyword (zach & report & alice) can't match the Bob
    // Fact, and the superseded Alice Fact is filtered out in SQL. Only the
    // semantic ranker surfaces the Current Bob Fact (its embedding is close), so
    // a hit here proves the semantic branch is doing the work, not keyword.
    const reportsTo = (await recall({ store, provider }, "Zach reports to Alice")).filter(
      (f) => f.predicate === "reports-to",
    );
    expect(reportsTo).toHaveLength(1);
    expect(reportsTo[0]?.object).toBe("Bob");
    expect(reportsTo[0]?.current).toBe(true);
  });

  it("the temporal filter applies to the semantic branch under as_of", async () => {
    // Same query, but as of a date when Alice was Current and Bob not yet valid:
    // the semantic ranker only sees Facts valid at that instant, so it returns
    // Alice (superseded now, but Current then) and never Bob.
    const facts = await recall({ store, provider }, "Zach reports to Alice", {
      asOf: new Date("2024-03-01T00:00:00Z"),
    });
    expect(facts.map((f) => f.object)).toEqual(["Alice"]);
    expect(facts[0]?.current).toBe(false);
  });
});

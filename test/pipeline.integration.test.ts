import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { recall, remember } from "../src/pipeline.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);
const extractor = new StubExtractor();

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("remember -> recall (walking skeleton)", () => {
  it("ingests a Source and recalls the Fact with its Source", async () => {
    await remember(store, extractor, "Zach reports to Alice.", "org-chart-q1");

    const facts = await recall(store, "Zach");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      subject: "Zach",
      predicate: "reports-to",
      object: "Alice",
      current: true,
    });
    expect(facts[0]?.source.label).toBe("org-chart-q1");
    expect(facts[0]?.source.text).toContain("Zach reports to Alice");
  });

  it("supersedes on a single-valued Predicate across two Sources", async () => {
    await remember(store, extractor, "[2024-01-01] Zach reports to Alice.", "q1");
    const second = await remember(store, extractor, "[2024-06-01] Zach reports to Bob.", "q2");

    // The second ingest closed exactly the Alice Fact and opened the Bob Fact.
    expect(second.factsSuperseded).toHaveLength(1);
    expect(second.factsSuperseded[0]).toMatchObject({ object: "Alice" });
    expect(second.factsCreated).toHaveLength(1);
    expect(second.factsCreated[0]).toMatchObject({ object: "Bob" });

    // Current recall returns only Bob.
    const current = await recall(store, "Zach");
    expect(current).toHaveLength(1);
    expect(current[0]?.object).toBe("Bob");

    // Both Facts retained: one reports-to Entity per subject, two reports-to rows.
    const all = await pool.query(
      "SELECT count(*)::int AS n FROM facts WHERE predicate = 'reports-to'",
    );
    expect(all.rows[0].n).toBe(2);
  });

  it("does NOT supersede on a multi-valued Predicate", async () => {
    await remember(store, extractor, "Zach knows Alice.", "s1");
    await remember(store, extractor, "Zach knows Bob.", "s2");

    const current = await recall(store, "Zach");
    const knows = current.filter((f) => f.predicate === "knows").map((f) => f.object).sort();
    expect(knows).toEqual(["Alice", "Bob"]);
  });
});

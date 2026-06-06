import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";

/**
 * Migration 0004: the pg_trgm GIN index that backs the `entities` tool's name
 * search. Proves the index exists AND that the planner actually uses it for the
 * `ILIKE '%q%'` pattern (under enable_seqscan=off it must pick the index if it is
 * applicable) — i.e. the index is functional, not decorative.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });

beforeEach(async () => {
  await pool.query("TRUNCATE fact_sources, facts, entities, sources RESTART IDENTITY CASCADE");
  for (const n of ["Zach", "Zachary", "Alice", "Bob", "Carol"]) {
    await pool.query("INSERT INTO entities (name, normalized_name) VALUES ($1, $2)", [n, n.toLowerCase()]);
  }
});

afterAll(async () => {
  await pool.end();
});

describe("entities trigram index (migration 0004)", () => {
  it("the GIN trigram index exists", async () => {
    const { rows } = await pool.query(
      "SELECT 1 FROM pg_indexes WHERE indexname = 'idx_entities_normalized_name_trgm'",
    );
    expect(rows).toHaveLength(1);
  });

  it("the planner uses it for the entities name search (ILIKE '%q%')", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off"); // force index use if applicable
      const { rows } = await client.query(
        "EXPLAIN SELECT id FROM entities WHERE normalized_name ILIKE '%zach%'",
      );
      const plan = rows.map((r) => r["QUERY PLAN"] as string).join("\n");
      expect(plan).toContain("idx_entities_normalized_name_trgm");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

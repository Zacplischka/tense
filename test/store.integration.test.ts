import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("schema", () => {
  it("enables the vector and pg_trgm extensions", async () => {
    const { rows } = await pool.query(
      "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm') ORDER BY extname",
    );
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "vector"]);
  });

  it("defines the Current partial index as `WHERE expired_at IS NULL`", async () => {
    const { rows } = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename = 'facts' AND indexname = 'idx_facts_current'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/WHERE \(expired_at IS NULL\)/);
  });

  it("has the bi-temporal columns on facts", async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'facts'
         AND column_name IN ('valid_at', 'invalid_at', 'created_at', 'expired_at')
       ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "created_at",
      "expired_at",
      "invalid_at",
      "valid_at",
    ]);
  });
});

describe("bi-temporal round-trip + provenance", () => {
  it("persists a Fact with its Source provenance link", async () => {
    const source = await store.insertSource("Zach reports to Alice.", "org-chart");
    const zach = await store.upsertEntity("Zach");
    const alice = await store.upsertEntity("Alice");

    const fact = await store.insertFact({
      subjectId: zach.id,
      predicate: "reports-to",
      objectId: alice.id,
      sourceId: source.id,
      validAt: new Date("2024-01-01T00:00:00Z"),
      invalidAt: null,
      expiredAt: null,
    });

    const reread = await store.getFact(fact.id);
    expect(reread).not.toBeNull();
    expect(reread?.sourceId).toBe(source.id);
    expect(reread?.validAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(reread?.expiredAt).toBeNull(); // born Current

    // The Fact -> Source FK is enforced.
    await expect(
      store.insertFact({
        subjectId: zach.id,
        predicate: "reports-to",
        objectId: alice.id,
        sourceId: "00000000-0000-0000-0000-000000000000",
        validAt: null,
        invalidAt: null,
        expiredAt: null,
      }),
    ).rejects.toThrow();
  });

  it("upsertEntity returns the same Entity for a repeated normalized name", async () => {
    const a = await store.upsertEntity("Zach");
    const b = await store.upsertEntity("  ZACH ");
    expect(b.id).toBe(a.id);
  });
});

describe("supersession (atomic boundary)", () => {
  async function seedReportsTo() {
    const source = await store.insertSource("seed", "seed");
    const zach = await store.upsertEntity("Zach");
    const alice = await store.upsertEntity("Alice");
    const alpha = await store.insertFact({
      subjectId: zach.id,
      predicate: "reports-to",
      objectId: alice.id,
      sourceId: source.id,
      validAt: new Date("2024-01-01T00:00:00Z"),
      invalidAt: null,
      expiredAt: null,
    });
    return { source, zach, alice, alpha };
  }

  it("closes the prior Fact and opens the new one — both rows retained", async () => {
    const { source, zach, alpha } = await seedReportsTo();
    const bob = await store.upsertEntity("Bob");
    const newValidAt = new Date("2024-06-01T00:00:00Z");
    const now = new Date();

    const { closed, inserted } = await store.supersedeAndInsert(
      [{ factId: alpha.id, invalidAt: newValidAt, expiredAt: now }],
      {
        subjectId: zach.id,
        predicate: "reports-to",
        objectId: bob.id,
        sourceId: source.id,
        validAt: newValidAt,
        invalidAt: null,
        expiredAt: null,
      },
    );

    expect(closed).toHaveLength(1);
    expect(closed[0]?.id).toBe(alpha.id);

    // Old Fact: valid-time end = new valid_at; transaction-time end set (retired).
    const oldFact = await store.getFact(alpha.id);
    expect(oldFact?.invalidAt?.toISOString()).toBe(newValidAt.toISOString());
    expect(oldFact?.expiredAt).not.toBeNull();

    // New Fact: Current.
    const newFact = await store.getFact(inserted.id);
    expect(newFact?.expiredAt).toBeNull();
    expect(newFact?.invalidAt).toBeNull();

    // Both rows still present — expire, never delete.
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM facts");
    expect(rows[0].n).toBe(2);

    // The Current partial index reflects exactly one Current Fact for the pair.
    const current = await store.currentFactsFor(zach.id, "reports-to");
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toBe(inserted.id);
  });

  it("rolls back the close if the insert fails (no torn state)", async () => {
    const { zach, alpha } = await seedReportsTo();
    const now = new Date();

    // Insert references a non-existent Source -> FK violation -> whole txn aborts.
    await expect(
      store.supersedeAndInsert([{ factId: alpha.id, invalidAt: now, expiredAt: now }], {
        subjectId: zach.id,
        predicate: "reports-to",
        objectId: zach.id,
        sourceId: "00000000-0000-0000-0000-000000000000",
        validAt: null,
        invalidAt: null,
        expiredAt: null,
      }),
    ).rejects.toThrow();

    // The prior Fact must remain Current — the close was rolled back.
    const stillCurrent = await store.currentFactsFor(zach.id, "reports-to");
    expect(stillCurrent).toHaveLength(1);
    expect(stillCurrent[0]?.id).toBe(alpha.id);
    expect(stillCurrent[0]?.expiredAt).toBeNull();
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);
const resolver = new EntityResolver(pool);

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("EntityResolver (real Postgres + pg_trgm)", () => {
  it("resolves an exact normalized-name match (case/whitespace-insensitive)", async () => {
    const zach = await store.upsertEntity("Zachary");
    const r = await resolver.resolve("  zachary ");
    expect(r).toMatchObject({ entityId: zach.id, reason: "exact" });
  });

  it("fuzzy-resolves a variant to the existing Entity (Zach -> Zachary)", async () => {
    const zachary = await store.upsertEntity("Zachary");
    const r = await resolver.resolve("Zach");
    expect(r.reason).toBe("fuzzy");
    expect(r.entityId).toBe(zachary.id);
  });

  it("fuzzy-resolves a typo (Zachery -> Zachary)", async () => {
    const zachary = await store.upsertEntity("Zachary");
    const r = await resolver.resolve("Zachery");
    expect(r.reason).toBe("fuzzy");
    expect(r.entityId).toBe(zachary.id);
  });

  it("short-name guard keeps distinct short names separate (Zach != Zara)", async () => {
    await store.upsertEntity("Zara");
    const r = await resolver.resolve("Zach");
    expect(r.reason).toBe("new");
    expect(r.entityId).toBeNull();
  });

  it("keeps clearly distinct entities separate", async () => {
    await store.upsertEntity("Alice");
    const r = await resolver.resolve("Bob");
    expect(r.reason).toBe("new");
  });

  it("returns 'new' when there are no entities yet", async () => {
    const r = await resolver.resolve("Zachary");
    expect(r).toMatchObject({ entityId: null, reason: "new" });
  });

  it("demo name-pair stability: the subject never forks across variants", async () => {
    // First mention creates the Entity; later variants all resolve back to it.
    const first = await store.upsertEntity("Zach");
    for (const variant of ["Zach", "zach", "Zachary"]) {
      const r = await resolver.resolve(variant);
      expect(r.entityId).toBe(first.id);
    }
    // And a genuinely different short name does not collapse into it.
    expect((await resolver.resolve("Zara")).entityId).not.toBe(first.id);
  });
});

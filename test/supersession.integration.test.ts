import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { resolveSupersession } from "../src/supersession/resolver.js";
import { applySupersessionPlan, toCandidateFact } from "../src/supersession/apply.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);
const registry = defaultPredicateRegistry();
const d = (iso: string) => new Date(iso);

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

/** Drive one incoming Fact through the full resolve -> apply path (as slice 07 will). */
async function ingest(opts: {
  subject: string;
  predicate: string;
  object: string;
  validAt: Date | null;
  now: Date;
}) {
  const source = await store.insertSource(`${opts.subject} ${opts.predicate} ${opts.object}`);
  const subject = await store.upsertEntity(opts.subject);
  const object = await store.upsertEntity(opts.object);

  const candidates = (await store.currentFactsFor(subject.id, opts.predicate)).map(toCandidateFact);
  const plan = resolveSupersession({
    newFact: { predicate: opts.predicate, validAt: opts.validAt },
    candidateFacts: candidates,
    registry,
    now: opts.now,
  });

  return applySupersessionPlan(store, plan, {
    subjectId: subject.id,
    predicate: opts.predicate,
    objectId: object.id,
    sourceId: source.id,
  });
}

describe("supersession resolver -> store (real Postgres)", () => {
  it("closes the prior Fact with correct intervals; both rows retained", async () => {
    await ingest({ subject: "Zach", predicate: "reports-to", object: "Alice", validAt: d("2024-01-01T00:00:00Z"), now: d("2026-01-01T00:00:00Z") });
    await ingest({ subject: "Zach", predicate: "reports-to", object: "Bob", validAt: d("2024-06-01T00:00:00Z"), now: d("2026-02-01T00:00:00Z") });

    const zach = await store.upsertEntity("Zach");

    // Exactly one Current Fact, and it points at Bob.
    const current = await store.currentFactsFor(zach.id, "reports-to");
    expect(current).toHaveLength(1);
    const bob = await store.getEntity(current[0]!.objectId);
    expect(bob?.name).toBe("Bob");

    // The Alice Fact: valid-time end = Bob's valid_at; transaction-time end set.
    const all = await pool.query(
      `SELECT obj.name AS object, f.invalid_at, f.expired_at
       FROM facts f JOIN entities obj ON obj.id = f.object_id
       WHERE f.predicate = 'reports-to' ORDER BY f.created_at`,
    );
    expect(all.rows).toHaveLength(2); // expire, never delete
    const alice = all.rows.find((r) => r.object === "Alice");
    expect(new Date(alice.invalid_at).toISOString()).toBe("2024-06-01T00:00:00.000Z");
    expect(alice.expired_at).not.toBeNull();
  });

  it("out-of-order ingest: the older Fact is born already-expired and the newer stays Current", async () => {
    // Newer truth ingested first.
    await ingest({ subject: "Zach", predicate: "reports-to", object: "Bob", validAt: d("2024-06-01T00:00:00Z"), now: d("2026-01-01T00:00:00Z") });
    // Then an older Fact arrives out of order.
    const { inserted } = await ingest({ subject: "Zach", predicate: "reports-to", object: "Alice", validAt: d("2024-01-01T00:00:00Z"), now: d("2026-02-01T00:00:00Z") });

    // The out-of-order Fact was born expired.
    const reread = await store.getFact(inserted.id);
    expect(reread?.expiredAt).not.toBeNull();
    expect(reread?.invalidAt?.toISOString()).toBe("2024-06-01T00:00:00.000Z");

    // Bob (the newer truth) remains the single Current Fact.
    const zach = await store.upsertEntity("Zach");
    const current = await store.currentFactsFor(zach.id, "reports-to");
    expect(current).toHaveLength(1);
    expect((await store.getEntity(current[0]!.objectId))?.name).toBe("Bob");
  });

  it("degenerate null valid_at: transaction-time fallback supersedes the prior Fact", async () => {
    await ingest({ subject: "Zach", predicate: "reports-to", object: "Alice", validAt: d("2024-01-01T00:00:00Z"), now: d("2026-01-01T00:00:00Z") });
    // "Zach now reports to Bob" — no extractable valid_at.
    await ingest({ subject: "Zach", predicate: "reports-to", object: "Bob", validAt: null, now: d("2026-02-01T00:00:00Z") });

    const zach = await store.upsertEntity("Zach");
    const current = await store.currentFactsFor(zach.id, "reports-to");
    expect(current).toHaveLength(1);
    expect((await store.getEntity(current[0]!.objectId))?.name).toBe("Bob");
  });

  it("multi-valued Predicate accumulates Current Facts (no supersession)", async () => {
    await ingest({ subject: "Zach", predicate: "knows", object: "Alice", validAt: null, now: d("2026-01-01T00:00:00Z") });
    await ingest({ subject: "Zach", predicate: "knows", object: "Bob", validAt: null, now: d("2026-02-01T00:00:00Z") });

    const zach = await store.upsertEntity("Zach");
    const current = await store.currentFactsFor(zach.id, "knows");
    expect(current).toHaveLength(2);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { resolveSupersession } from "../src/supersession/resolver.js";
import { applySupersessionPlan, toCandidateFact } from "../src/supersession/apply.js";
import { fetchSnapshot } from "../viewer/lib/snapshot.js";

/**
 * The viewer's entire read path is `fetchSnapshot` — the SQL that powers the
 * live grey-out demo. The pure mapping in graph-model.ts is unit-tested, but the
 * SQL itself (Current derived from `expired_at IS NULL`, the entity/source joins,
 * `reinforcedBy`/`citedBy`, and the append-only layout ordering) was only ever
 * exercised through the running app. This locks it against real Postgres so a
 * silent break in the demo's read query fails CI, not the recording.
 *
 * `fetchSnapshot` reads `process.env.TENSE_DATABASE_URL` via its own pool; the
 * vitest harness forces that to the isolated `tense_test` database, so this hits
 * the same rows the store below writes.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);
const registry = defaultPredicateRegistry();
const d = (iso: string) => new Date(iso);

/** Drive one incoming Fact through resolve -> apply, carrying a Source label so
 *  the snapshot's provenance (`citedBy`) is checkable. */
async function ingest(opts: {
  subject: string;
  predicate: string;
  object: string;
  validAt: Date | null;
  now: Date;
  label: string;
}) {
  const source = await store.insertSource(
    `${opts.subject} ${opts.predicate} ${opts.object}`,
    opts.label,
  );
  const subject = await store.upsertEntity(opts.subject);
  const object = await store.upsertEntity(opts.object);

  const candidates = (await store.currentFactsFor(subject.id, opts.predicate)).map(toCandidateFact);
  const plan = resolveSupersession({
    newFact: { predicate: opts.predicate, validAt: opts.validAt },
    candidateFacts: candidates,
    registry,
    now: opts.now,
  });

  const applied = await applySupersessionPlan(store, plan, {
    subjectId: subject.id,
    predicate: opts.predicate,
    objectId: object.id,
    sourceId: source.id,
  });
  // Provenance link, as the real pipeline records it (src/pipeline.ts) — this is
  // what `reinforcedBy`/`citedBy` count, not the Fact's own source_id column.
  await store.addFactSource(applied.inserted.id, source.id);
  return applied;
}

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("fetchSnapshot (viewer read path, real Postgres)", () => {
  it("returns an empty snapshot before anything is ingested", async () => {
    const snap = await fetchSnapshot();
    expect(snap).toEqual({ entities: [], facts: [] });
  });

  it("renders the org-change story the way the viewer draws it", async () => {
    // Alice [2024-01-01 .. open), then Bob supersedes her [2024-06-01 .. open).
    await ingest({
      subject: "Zach", predicate: "reports-to", object: "Alice",
      validAt: d("2024-01-01T00:00:00Z"), now: d("2026-01-01T00:00:00Z"), label: "org-2024q1",
    });
    await ingest({
      subject: "Zach", predicate: "reports-to", object: "Bob",
      validAt: d("2024-06-01T00:00:00Z"), now: d("2026-02-01T00:00:00Z"), label: "org-2024q2",
    });

    const snap = await fetchSnapshot();

    // Append-only layout key: entities come back in creation order (Zach, Alice,
    // Bob), so an existing node's on-screen position never shifts (ADR slice 02).
    expect(snap.entities.map((e) => e.name)).toEqual(["Zach", "Alice", "Bob"]);

    const byObject = (name: string) => snap.facts.find((f) => f.object === name);
    const alice = byObject("Alice");
    const bob = byObject("Bob");
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    // Current is derived from `expired_at IS NULL` — NOT from invalid_at. The
    // greyed (superseded) edge is Alice; the solid (Current) edge is Bob.
    expect(alice!.current).toBe(false);
    expect(bob!.current).toBe(true);

    // Valid-time interval round-trips as ISO; Alice closes exactly when Bob opens.
    expect(alice!.validAt).toBe("2024-01-01T00:00:00.000Z");
    expect(alice!.invalidAt).toBe("2024-06-01T00:00:00.000Z");
    expect(bob!.validAt).toBe("2024-06-01T00:00:00.000Z");
    expect(bob!.invalidAt).toBeNull();

    // Subject/object display names come from the joins (the detail panel needs them).
    expect(bob!.subject).toBe("Zach");
    expect(bob!.object).toBe("Bob");

    // Transaction time is populated (the "learned at" axis the panel shows).
    expect(bob!.learnedAt).toBeTruthy();

    // One Source each so far; provenance label flows through to `citedBy`.
    expect(bob!.reinforcedBy).toBe(1);
    expect(bob!.citedBy).toEqual(["org-2024q2"]);
  });

  it("counts a Reaffirmation as a second Source, ordered, in reinforcedBy/citedBy", async () => {
    await ingest({
      subject: "Zach", predicate: "reports-to", object: "Bob",
      validAt: d("2024-06-01T00:00:00Z"), now: d("2026-02-01T00:00:00Z"), label: "org-2024q2",
    });

    const zach = await store.upsertEntity("Zach");
    const [bobFact] = await store.currentFactsFor(zach.id, "reports-to");
    expect(bobFact).toBeDefined();

    // A second Source asserting the same Fact (Reaffirmation, ADR 0005) — not a
    // duplicate Fact, just more provenance.
    const reaffirm = await store.insertSource("Zach still reports to Bob.", "standup-note");
    await store.addFactSource(bobFact!.id, reaffirm.id);

    const snap = await fetchSnapshot();
    const bob = snap.facts.find((f) => f.object === "Bob")!;
    expect(bob.reinforcedBy).toBe(2);
    // Ordered by Source creation time: the original Source first, then the Reaffirmation.
    expect(bob.citedBy).toEqual(["org-2024q2", "standup-note"]);
  });
});

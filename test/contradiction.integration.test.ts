import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { resolveContradictions } from "../src/contradiction/contradiction.js";
import type { CompletionResult, ProviderClient } from "../src/provider/types.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);

/** A judge that nominates every candidate id whose object matches `object`. */
function judge(targetObject: string): ProviderClient {
  return {
    async complete(req): Promise<CompletionResult> {
      // Echo back ids whose line mentions the target object.
      const prompt = (req.prompt ?? "") + (req.messages?.map((m) => m.content).join("\n") ?? "");
      const ids = [...prompt.matchAll(/id=([0-9a-f-]{36}):\s*(.+)/g)]
        .filter((m) => m[2]!.includes(targetObject))
        .map((m) => m[1]!);
      return { text: JSON.stringify({ contradicted_ids: ids }), model: "judge" };
    },
    async embed(): Promise<number[][]> {
      return [];
    },
  };
}

async function seedFact(subjectName: string, predicate: string, objectName: string, validAt: Date | null) {
  const source = await store.insertSource(`${subjectName} ${predicate} ${objectName}`);
  const subject = await store.upsertEntity(subjectName);
  const object = await store.upsertEntity(objectName);
  const fact = await store.insertFact({
    subjectId: subject.id,
    predicate,
    objectId: object.id,
    sourceId: source.id,
    validAt,
    invalidAt: null,
    expiredAt: null,
  });
  return { fact, subject, object };
}

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("LLM-judged contradiction (cross-predicate)", () => {
  it("retires works-at when left is ingested (older Fact closes)", async () => {
    const worksAt = await seedFact("Alice", "works-at", "Acme", new Date("2020-01-01T00:00:00Z"));
    const left = await seedFact("Alice", "left", "Acme", new Date("2024-01-01T00:00:00Z"));

    const closed = await resolveContradictions(
      { store, provider: judge("Acme"), now: () => new Date("2026-01-01T00:00:00Z") },
      {
        id: left.fact.id,
        subjectId: left.subject.id,
        subject: "Alice",
        predicate: "left",
        object: "Acme",
        validAt: new Date("2024-01-01T00:00:00Z"),
      },
    );

    // The works-at Fact (earlier valid_at) is the one closed.
    expect(closed.map((f) => f.id)).toEqual([worksAt.fact.id]);
    const reread = await store.getFact(worksAt.fact.id);
    expect(reread?.expiredAt).not.toBeNull();
    expect(reread?.invalidAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z"); // = left's valid_at
    // The "left" Fact stays Current.
    expect((await store.getFact(left.fact.id))?.expiredAt).toBeNull();
  });

  it("does not close coexisting Facts when the judge nominates none", async () => {
    await seedFact("Zoe", "knows", "Ann", null);
    const knowsBen = await seedFact("Zoe", "knows", "Ben", null);

    const closed = await resolveContradictions(
      { store, provider: judge("__none__"), now: () => new Date("2026-01-01T00:00:00Z") },
      { id: knowsBen.fact.id, subjectId: knowsBen.subject.id, subject: "Zoe", predicate: "knows", object: "Ben", validAt: null },
    );
    expect(closed).toEqual([]);
    expect((await store.currentFactsForSubject(knowsBen.subject.id))).toHaveLength(2);
  });
});

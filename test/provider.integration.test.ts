import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { createProvider } from "../src/provider/openrouter.js";

const hasKey = !!process.env.OPENROUTER_API_KEY;
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const store = new TemporalGraphStore(pool);

beforeEach(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

// Live OpenRouter calls — skipped when no key is configured so the suite stays green.
describe.skipIf(!hasKey)("provider (live OpenRouter + real Postgres)", () => {
  it("returns a real completion", async () => {
    const provider = createProvider();
    const { text, model } = await provider.complete({
      prompt: "Reply with exactly one word: pong",
      maxTokens: 10,
    });
    expect(text.toLowerCase()).toContain("pong");
    expect(model).toBeTruthy();
  });

  it("embeds a Fact and stores it in pgvector", async () => {
    const provider = createProvider();
    const source = await store.insertSource("Zach reports to Bob.");
    const zach = await store.upsertEntity("Zach");
    const bob = await store.upsertEntity("Bob");
    const fact = await store.insertFact({
      subjectId: zach.id,
      predicate: "reports-to",
      objectId: bob.id,
      sourceId: source.id,
      validAt: null,
      invalidAt: null,
      expiredAt: null,
    });

    const [embedding] = await provider.embed(["Zach reports-to Bob"]);
    expect(embedding && embedding.length).toBeGreaterThan(0);

    await store.setFactEmbedding(fact.id, embedding!);
    expect(await store.hasEmbedding(fact.id)).toBe(true);

    // The stored dimension matches the migration's vector(1536).
    const { rows } = await pool.query(
      "SELECT vector_dims(embedding) AS dims FROM facts WHERE id = $1",
      [fact.id],
    );
    expect(rows[0].dims).toBe(1536);
  });
});

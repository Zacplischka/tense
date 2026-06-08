import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { BagOfWordsProvider } from "../eval/bag-of-words-provider.js";
import { DEMO_QUESTIONS, SOURCES, runAgentScenario } from "../scripts/demo-agent.js";

/**
 * Locks the `pnpm demo:agent` artifact: the agent's-eye demo must keep showing
 * the headline win (Tense right point-in-time, the vector baseline wrong) and the
 * fair-baseline control (both right "now"). The demo reuses the production
 * `recall`/`baselineAnswer` paths, so this guards the *claim the README makes
 * about the demo* against drift — not a second copy of the engine logic.
 */
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const provider = new BagOfWordsProvider();
const deps: RememberDeps = {
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(),
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  provider,
};

beforeAll(async () => {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
  for (const s of SOURCES) await remember(deps, s.text, s.label);
});

afterAll(async () => {
  await pool.end();
});

describe("demo:agent — the agent's-eye context comparison", () => {
  it("point-in-time: Tense hands the agent the historically-correct Fact; the vector baseline does not", async () => {
    const pit = DEMO_QUESTIONS.find((q) => q.asOf !== null)!;
    const s = await runAgentScenario(deps.store, provider, pit);

    expect(s.gold).toBe("Alice");
    // Tense: right answer, AND the temporal evidence that justifies it.
    expect(s.tense.answer).toBe("Alice");
    expect(s.tense.current).toBe(false);
    expect(s.tense.validAt).toBe("2024-01-01");
    expect(s.tense.invalidAt).toBe("2024-06-01");
    expect(s.tense.source).toBe("org-2024q1");
    // Vector baseline: wrong — returns the most-recent value, blind to as_of.
    expect(s.baseline.answer).toBe("Bob");
    // Fairness: the superseded Fact IS in the baseline's candidate pool, so the
    // miss is a ranking choice, not blindness.
    expect(s.baseline.candidates.map((c) => c.object).sort()).toEqual(["Alice", "Bob"]);
  });

  it('now: both Tense and the vector baseline return the Current Fact (the baseline is fair)', async () => {
    const now = DEMO_QUESTIONS.find((q) => q.asOf === null)!;
    const s = await runAgentScenario(deps.store, provider, now);

    expect(s.gold).toBe("Bob");
    expect(s.tense.answer).toBe("Bob");
    expect(s.tense.current).toBe(true);
    expect(s.baseline.answer).toBe("Bob");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { TEST_DATABASE_URL } from "./globalSetup.js";
import { BagOfWordsProvider } from "../eval/bag-of-words-provider.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { GOLD_SCENARIOS } from "../eval/gold.js";
import { runEval, type HarnessDeps } from "../eval/harness.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: HarnessDeps = {
  pool,
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(), // deterministic extraction
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  provider: new BagOfWordsProvider(), // deterministic embeddings for the baseline
};

// Stub-extractable scenarios only (exclude the LLM-judged cross-predicate case).
const scenarios = GOLD_SCENARIOS.filter((s) => !s.tags.includes("llm-only"));

let report: Awaited<ReturnType<typeof runEval>>;

beforeAll(async () => {
  report = await runEval(deps, { scenarios });
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe("eval harness (deterministic: stub extraction + fair baseline)", () => {
  it("extracts the gold triples (stub is exact)", () => {
    expect(report.tripleF1).toBeGreaterThanOrEqual(0.95);
    expect(report.validAtAccuracy).toBeGreaterThanOrEqual(0.95);
  });

  it("supersession has high recall and ZERO false-supersession (still-true Facts kept)", () => {
    expect(report.supersession.recall).toBeGreaterThanOrEqual(0.9);
    expect(report.supersession.falseSupersessionRate).toBe(0);
  });

  it("THE HEADLINE: Tense beats the fair baseline on point-in-time questions", () => {
    // Tense answers as_of questions correctly; the baseline (no bi-temporal
    // model) returns the most-recent answer and loses on changed-over-time ones.
    expect(report.qa.changedOverTime.tense).toBe(1);
    expect(report.qa.changedOverTime.baseline).toBeLessThan(report.qa.changedOverTime.tense);
    // On current questions both should do well -> baseline isn't a strawman.
    expect(report.qa.overall.baseline).toBeGreaterThan(0);
  });
});

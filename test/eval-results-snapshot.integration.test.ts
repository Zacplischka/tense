/**
 * Drift guard for the committed `eval/RESULTS.md` snapshot.
 *
 * The README promises that `eval/RESULTS.md` is "a committed, byte-identical
 * snapshot" of the offline eval — the numbers a reviewer reads on GitHub without
 * running anything. That promise is only worth as much as it is enforced: if the
 * gold set, the metrics, or the renderer change and someone forgets to run
 * `pnpm eval:report`, the committed file silently drifts from reality and the
 * README starts lying.
 *
 * This test re-runs the exact offline pipeline `pnpm eval:report` uses (stub
 * extraction + bag-of-words embeddings, the non-`llm-only` scenarios) and asserts
 * the freshly-rendered markdown — and the accuracy chart SVG — are identical to the
 * committed files. It fails loudly with the one command that fixes it, so neither
 * snapshot can go stale unnoticed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
import { renderResultsMarkdown } from "../eval/report.js";
import { renderAccuracyChartSvg } from "../eval/chart.js";

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const deps: HarnessDeps = {
  pool,
  store: new TemporalGraphStore(pool),
  extractor: new StubExtractor(), // deterministic extraction (no LLM)
  resolver: new EntityResolver(pool),
  registry: defaultPredicateRegistry(),
  provider: new BagOfWordsProvider(), // deterministic embeddings (no API key)
};

// The exact filter eval/run-offline.ts applies: stub-extractable scenarios only.
const scenarios = GOLD_SCENARIOS.filter((s) => !s.tags.includes("llm-only"));

const committedPath = fileURLToPath(new URL("../eval/RESULTS.md", import.meta.url));
const committedSvgPath = fileURLToPath(new URL("../docs/media/accuracy.svg", import.meta.url));

let rendered: string;
let renderedSvg: string;

beforeAll(async () => {
  const report = await runEval(deps, { scenarios });
  rendered = renderResultsMarkdown(report);
  renderedSvg = renderAccuracyChartSvg(report);
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe("committed eval/RESULTS.md is in sync with the offline eval", () => {
  it("is byte-identical to a fresh `pnpm eval:report` render", () => {
    const committed = readFileSync(committedPath, "utf8");
    expect(
      rendered,
      "eval/RESULTS.md is stale — regenerate it with `pnpm eval:report` and commit the result.",
    ).toBe(committed);
  });

  it("docs/media/accuracy.svg is in sync with the offline eval", () => {
    const committed = readFileSync(committedSvgPath, "utf8");
    expect(
      renderedSvg,
      "docs/media/accuracy.svg is stale — regenerate it with `pnpm eval:report` and commit the result.",
    ).toBe(committed);
  });
});

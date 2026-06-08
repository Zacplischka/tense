/**
 * Offline eval runner — the no-API-key reproduction of the headline.
 *
 *   pnpm eval:offline
 *
 * Identical harness, scenarios, and metrics as `pnpm eval`, but swaps the two
 * paid network dependencies for deterministic doubles:
 *   - extraction  → StubExtractor       (regex over the gold grammar; no LLM)
 *   - embeddings  → BagOfWordsProvider   (hashed term-frequency vectors; no API)
 *
 * So a reviewer with only Postgres — no OpenRouter key, no spend — can reproduce
 * the headline (Tense beats the fair vector baseline on point-in-time questions)
 * deterministically, getting the SAME 100% / 0% every run.
 *
 * The one cross-predicate scenario (works-at → left) is LLM-judged, so it is
 * excluded here (the stub can't extract "left" and the contradiction path needs a
 * model); run `pnpm eval` for that scenario. Every QA question — all 11, including
 * the 5 point-in-time ones — lives in the stub-extractable scenarios, so the
 * headline is fully covered offline.
 *
 * Uses TENSE_EVAL_DATABASE_URL (default: …/tense_eval) so it never touches the
 * demo or test databases.
 */
import "../src/env.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ensureDatabase, migrate } from "../src/db/migrate.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { BagOfWordsProvider } from "./bag-of-words-provider.js";
import { GOLD_SCENARIOS } from "./gold.js";
import { runEval } from "./harness.js";
import { renderQaBreakdown, renderResultsMarkdown } from "./report.js";

const EVAL_DB_URL =
  process.env.TENSE_EVAL_DATABASE_URL ?? "postgres://postgres:tense@localhost:5432/tense_eval";

// Stub-extractable scenarios only (exclude the LLM-judged cross-predicate case) —
// the same filter the deterministic harness test applies.
const scenarios = GOLD_SCENARIOS.filter((s) => !s.tags.includes("llm-only"));

async function main(): Promise<void> {
  await ensureDatabase(EVAL_DB_URL);
  await migrate(EVAL_DB_URL);

  const pool = new pg.Pool({ connectionString: EVAL_DB_URL });
  const deps = {
    pool,
    store: new TemporalGraphStore(pool),
    extractor: new StubExtractor(), // deterministic extraction (no LLM)
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
    provider: new BagOfWordsProvider(), // deterministic embeddings (no API key)
  };

  console.log(
    `Running Tense eval OFFLINE (stub extraction + bag-of-words embeddings, no API key)\n` +
      `over ${scenarios.length} stub-extractable scenarios…\n`,
  );
  const r = await runEval(deps, { scenarios });
  await pool.end();

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`Scenarios:              ${r.scenarios}`);
  console.log(`Triple-F1 (extraction): ${pct(r.tripleF1)}`);
  console.log(`valid_at accuracy:      ${pct(r.validAtAccuracy)}`);
  console.log(
    `Supersession:           P=${pct(r.supersession.precision)} R=${pct(r.supersession.recall)} ` +
      `false-supersession=${pct(r.supersession.falseSupersessionRate)}`,
  );
  console.log("");
  console.log(`Temporal-QA (all ${r.qa.count}):           Tense ${pct(r.qa.overall.tense)}  vs  baseline ${pct(r.qa.overall.baseline)}`);
  console.log("──────────────────────────────────────────────────────────");
  console.log(
    `HEADLINE — point-in-time (${r.qa.changedCount}): Tense ${pct(r.qa.changedOverTime.tense)}  vs  baseline ${pct(r.qa.changedOverTime.baseline)}`,
  );
  console.log("──────────────────────────────────────────────────────────");
  console.log("");
  console.log(renderQaBreakdown(r));
  console.log("");
  console.log("Deterministic: these numbers are identical on every run (no model, no network).");

  if (process.argv.includes("--write")) {
    const out = fileURLToPath(new URL("./RESULTS.md", import.meta.url));
    writeFileSync(out, renderResultsMarkdown(r));
    console.log(`\nWrote eval/RESULTS.md (committed reviewer snapshot).`);
  }
}

main().catch((err) => {
  console.error("offline eval failed:", err);
  process.exit(1);
});

/**
 * Live eval runner (slice 13): bootstraps a dedicated eval database, ingests the
 * full gold set with the REAL extractor + embeddings, and prints the metrics —
 * including the headline temporal-QA head-to-head (Tense vs the fair baseline).
 *
 *   pnpm eval
 *
 * Uses TENSE_EVAL_DATABASE_URL (default: …/tense_eval) so it never touches the
 * demo or test databases.
 */
import "../src/env.js";
import pg from "pg";
import { ensureDatabase, migrate } from "../src/db/migrate.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { LlmExtractor } from "../src/extraction/llm-extractor.js";
import { createProvider } from "../src/provider/openrouter.js";
import { runEval } from "./harness.js";

const EVAL_DB_URL =
  process.env.TENSE_EVAL_DATABASE_URL ?? "postgres://postgres:tense@localhost:5432/tense_eval";

async function main(): Promise<void> {
  await ensureDatabase(EVAL_DB_URL);
  await migrate(EVAL_DB_URL);

  const pool = new pg.Pool({ connectionString: EVAL_DB_URL });
  const provider = createProvider();
  const deps = {
    pool,
    store: new TemporalGraphStore(pool),
    extractor: new LlmExtractor(provider),
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
    provider,
    enableContradiction: true, // exercise the general path (cross-predicate)
  };

  console.log("Running Tense eval over the gold set (real extraction + embeddings)…\n");
  const r = await runEval(deps);
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
}

main().catch((err) => {
  console.error("eval failed:", err);
  process.exit(1);
});

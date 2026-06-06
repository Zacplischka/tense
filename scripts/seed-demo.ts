/**
 * Demo seed (slice 16): loads the flagship 3-beat org-change story with
 * **pinned/replayed extraction** — the deterministic StubExtractor, NOT the live
 * LLM — so the only things live on camera are the supersession resolver and the
 * viewer. This is what keeps the "deterministic" demo deterministic.
 *
 *   pnpm seed:demo            # Beat 1: seed the initial graph (truncates first)
 *   pnpm seed:demo beat2      # Beat 2: feed the conflicting Source (live grey-out)
 *   pnpm seed:demo all        # both, for a non-interactive dry run
 *
 * After Beat 1 it runs the GOLDEN SINGLE-ENTITY ASSERTION: the subject must
 * resolve to exactly one Entity, or the old edge would fork instead of greying.
 */
import "../src/env.js";
import pg from "pg";
import { ensureDatabase, migrate } from "../src/db/migrate.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { createProvider } from "../src/provider/openrouter.js";
import { remember, type RememberDeps } from "../src/pipeline.js";

const BEAT1 = [
  { label: "org-2024q1", text: "[2024-01-01] Zach reports to Alice." },
  { label: "team", text: "[2024-01-01] Zach knows Carol." },
  { label: "location", text: "[2024-01-01] Zach lives in Berlin." },
];
const BEAT2 = [{ label: "org-2024q2", text: "[2024-06-01] Zach reports to Bob." }];

const DB_URL = process.env.TENSE_DATABASE_URL ?? "postgres://postgres:tense@localhost:5432/tense";

async function main(): Promise<void> {
  const beat = process.argv[2] ?? "beat1";
  await ensureDatabase(DB_URL);
  await migrate(DB_URL);

  const pool = new pg.Pool({ connectionString: DB_URL });
  // Embeddings (deterministic) are fine to use live; extraction is pinned.
  let provider;
  try {
    provider = createProvider();
  } catch {
    provider = undefined; // seed still works without embeddings (keyword recall)
  }

  const deps: RememberDeps = {
    store: new TemporalGraphStore(pool),
    extractor: new StubExtractor(), // pinned/replayed extraction
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
    provider,
    enableContradiction: false, // keep the demo path deterministic (cardinality only)
  };

  if (beat === "beat1" || beat === "all") {
    await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
    for (const s of BEAT1) await remember(deps, s.text, s.label);
    await assertSingleSubject(pool, "zach");
    console.log("[seed] Beat 1 loaded (Zach → Alice / knows Carol / lives in Berlin).");
  }

  if (beat === "beat2" || beat === "all") {
    for (const s of BEAT2) await remember(deps, s.text, s.label);
    console.log("[seed] Beat 2 loaded (Zach → Bob) — the reports-to edge greys out.");
  }

  await pool.end();
  console.log("[seed] done.");
}

/** GOLDEN ASSERTION: the demo subject must be a single Entity (no fork). */
async function assertSingleSubject(pool: pg.Pool, normalizedName: string): Promise<void> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM entities WHERE normalized_name = $1", [
    normalizedName,
  ]);
  if (rows[0].n !== 1) {
    throw new Error(`Golden assertion FAILED: subject "${normalizedName}" resolved to ${rows[0].n} Entities (expected 1).`);
  }
  console.log(`[seed] golden assertion ok: "${normalizedName}" → 1 Entity.`);
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

/**
 * Recall latency benchmark — answers the one question the accuracy eval doesn't:
 * is Tense fast enough to sit in an agent's hot path?
 *
 *   pnpm bench            # default: 400-Fact corpus, 200 timed recalls
 *   pnpm bench 1000 500   # <corpus subjects> <timed iterations>
 *
 * Offline and deterministic in SHAPE (StubExtractor + BagOfWordsProvider, Postgres
 * only, no API key) so anyone can reproduce it. The latency NUMBERS are
 * machine-dependent — that is the point of running it on your own hardware. It
 * exercises the real read path: temporal filter in SQL → pgvector cosine +
 * full-text → RRF, the same `recall()` the MCP server serves.
 *
 * Uses TENSE_EVAL_DATABASE_URL (default: …/tense_eval) so it never touches the
 * demo or test databases. It truncates that graph first, then seeds a synthetic
 * org chart with supersessions (so the temporal filter has superseded Facts to
 * exclude — the realistic case).
 */
import "../src/env.js";
import { performance } from "node:perf_hooks";
import pg from "pg";
import { ensureDatabase, migrate } from "../src/db/migrate.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import { BagOfWordsProvider } from "./bag-of-words-provider.js";

const EVAL_DB_URL =
  process.env.TENSE_EVAL_DATABASE_URL ?? "postgres://postgres:tense@localhost:5432/tense_eval";

const SUBJECTS = Number(process.argv[2]) || 400;
const ITERATIONS = Number(process.argv[3]) || 200;

/** A small fixed vocabulary keeps the corpus deterministic and the queries hit. */
const CITIES = ["Berlin", "Munich", "Paris", "Lisbon", "Oslo", "Dublin", "Madrid", "Prague"];
const MANAGERS = ["Alice", "Bob", "Carol", "Dana", "Erin", "Frank", "Grace", "Heidi"];

// A 32-syllable pool: with four syllables per name (32^4 combinations) and the
// scrambling hash below, near-zero pairs land within the resolver's 0.4 trigram
// threshold, so subjects keep their own Entities.
const SYL = [
  "ba", "ke", "ti", "mo", "lu", "ra", "ne", "so", "vi", "du", "ga", "pe", "zo", "ja", "fy", "wu",
  "cha", "rin", "dol", "vex", "kip", "nub", "toz", "wem", "lyx", "qua", "pho", "gri", "sed", "yon", "bru", "fim",
];

/**
 * A deterministic, lexically-distinct subject name for index `i`. The four
 * syllables are picked from the low 16 bits of Knuth's multiplicative hash of `i`:
 * the hash is a bijection on those bits (so every `i` yields a UNIQUE name), and it
 * scrambles them (so consecutive names differ across all positions — keeping
 * trigram similarity between any two well under the resolver's 0.4 fuzzy threshold,
 * so each subject resolves to its OWN Entity). A naive `Person${i}` scheme instead
 * collapses into one Entity under pg_trgm — the degeneracy `seedCorpus` asserts away.
 */
function subjectName(i: number): string {
  const m = Math.imul(i, 2654435761) >>> 0; // Knuth multiplicative hash (32-bit)
  const syl = (shift: number) => SYL[(m >>> shift) & 31]!;
  const cap = (x: string) => x[0]!.toUpperCase() + x.slice(1);
  return `${cap(syl(0))}${syl(5)} ${cap(syl(10))}${syl(15)}`;
}

/** percentile via nearest-rank on a sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(rank, sortedAsc.length) - 1]!;
}

async function seedCorpus(deps: RememberDeps, pool: pg.Pool): Promise<void> {
  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
  for (let i = 0; i < SUBJECTS; i++) {
    const person = subjectName(i);
    const mgr1 = MANAGERS[i % MANAGERS.length]!;
    const mgr2 = MANAGERS[(i + 3) % MANAGERS.length]!;
    const city = CITIES[i % CITIES.length]!;
    // First reporting line + a move, so half the corpus carries a superseded Fact
    // the temporal filter must exclude on a Current recall.
    await remember(deps, `[2022-01-01] ${person} reports to ${mgr1}.`, `seed-${i}-a`);
    if (i % 2 === 0) {
      await remember(deps, `[2023-06-01] ${person} reports to ${mgr2}.`, `seed-${i}-b`);
    }
    await remember(deps, `${person} lives in ${city}.`, `seed-${i}-c`);
  }

  // A degenerate corpus (subjects fuzzy-merged into one Entity) would make the
  // latency meaningless — fail loudly rather than benchmark a collapsed graph.
  const { entities } = await deps.store.graphStats();
  if (entities < SUBJECTS * 0.9) {
    throw new Error(
      `corpus collapsed: ${entities} Entities for ${SUBJECTS} subjects — names fuzzy-merged under pg_trgm`,
    );
  }
}

async function main(): Promise<void> {
  await ensureDatabase(EVAL_DB_URL);
  await migrate(EVAL_DB_URL);

  const pool = new pg.Pool({ connectionString: EVAL_DB_URL });
  const deps: RememberDeps = {
    store: new TemporalGraphStore(pool),
    extractor: new StubExtractor(),
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
    provider: new BagOfWordsProvider(),
  };

  console.log(
    `Tense recall benchmark — offline (stub extraction + bag-of-words embeddings, no API key)\n` +
      `Seeding ${SUBJECTS} subjects…`,
  );
  const seedStart = performance.now();
  await seedCorpus(deps, pool);
  const seedMs = performance.now() - seedStart;

  const recallDeps = { store: deps.store, provider: deps.provider };
  const factCounts = await deps.store.graphStats();

  // A spread of realistic queries: Current and point-in-time, semantic and scoped.
  const queries: Array<{ q: string; asOf: Date | null }> = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const person = subjectName(i % SUBJECTS);
    if (i % 3 === 0) queries.push({ q: `who does ${person} report to`, asOf: null });
    else if (i % 3 === 1) queries.push({ q: `who does ${person} report to`, asOf: new Date("2022-09-01") });
    else queries.push({ q: `where does ${person} live`, asOf: null });
  }

  // Warm up the pool, query plans, and JIT before timing.
  for (let i = 0; i < 20; i++) await recall(recallDeps, queries[i % queries.length]!.q, { asOf: queries[i % queries.length]!.asOf });

  const samples: number[] = [];
  for (const { q, asOf } of queries) {
    const t0 = performance.now();
    await recall(recallDeps, q, { asOf });
    samples.push(performance.now() - t0);
  }
  await pool.end();

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  const fmt = (x: number) => `${x.toFixed(1)} ms`;

  console.log(
    `\nCorpus: ${factCounts.facts.current} Current Facts, ${factCounts.facts.superseded} superseded, ` +
      `${factCounts.entities} Entities, ${factCounts.sources} Sources (seeded in ${(seedMs / 1000).toFixed(1)}s)`,
  );
  console.log(`Read path: temporal filter in SQL → pgvector cosine + full-text → RRF`);
  console.log(`Timed recalls: ${samples.length} (mix of Current, point-in-time as_of, and lives-in queries)\n`);
  console.log(`  p50   ${fmt(percentile(samples, 50))}`);
  console.log(`  p95   ${fmt(percentile(samples, 95))}`);
  console.log(`  p99   ${fmt(percentile(samples, 99))}`);
  console.log(`  mean  ${fmt(mean)}`);
  console.log(`  min   ${fmt(samples[0]!)}    max   ${fmt(samples[samples.length - 1]!)}`);
  console.log(
    `\nLatency is machine-dependent; reproduce on your hardware with \`pnpm bench\`. ` +
      `Corpus shape is deterministic.`,
  );
}

main().catch((err) => {
  console.error("bench failed:", err);
  process.exit(1);
});

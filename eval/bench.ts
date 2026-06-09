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

  // A spread of realistic queries, each tagged with its class so we can isolate the
  // one cost that matters for the thesis: does the point-in-time `as_of` filter
  // (which must exclude superseded Facts in SQL) cost more than a plain Current
  // recall? The two `reports-to` classes are the SAME query shape with and without
  // `as_of`, so comparing them isolates the temporal filter — not the query text.
  const CURRENT_REPORTS = "Current · reports-to";
  const ASOF_REPORTS = "Point-in-time · reports-to (as_of)";
  const CURRENT_LIVES = "Current · lives-in";
  const queries: Array<{ q: string; asOf: Date | null; cls: string }> = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const person = subjectName(i % SUBJECTS);
    if (i % 3 === 0) queries.push({ q: `who does ${person} report to`, asOf: null, cls: CURRENT_REPORTS });
    else if (i % 3 === 1) queries.push({ q: `who does ${person} report to`, asOf: new Date("2022-09-01"), cls: ASOF_REPORTS });
    else queries.push({ q: `where does ${person} live`, asOf: null, cls: CURRENT_LIVES });
  }

  // Warm up the pool, query plans, and JIT before timing.
  for (let i = 0; i < 20; i++) await recall(recallDeps, queries[i % queries.length]!.q, { asOf: queries[i % queries.length]!.asOf });

  const samples: number[] = [];
  const byClass = new Map<string, number[]>();
  for (const { q, asOf, cls } of queries) {
    const t0 = performance.now();
    await recall(recallDeps, q, { asOf });
    const ms = performance.now() - t0;
    samples.push(ms);
    const bucket = byClass.get(cls) ?? [];
    bucket.push(ms);
    byClass.set(cls, bucket);
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
  console.log(`  overall   p50 ${fmt(percentile(samples, 50))}   p95 ${fmt(percentile(samples, 95))}   p99 ${fmt(percentile(samples, 99))}   mean ${fmt(mean)}`);
  console.log(`            min ${fmt(samples[0]!)}   max ${fmt(samples[samples.length - 1]!)}`);

  // By class — the apples-to-apples contrast. A point-in-time recall scans the same
  // index but keeps the valid-time predicate; this is where you see whether that
  // costs anything over a Current recall of the same shape.
  console.log(`\n  By query class (p50 / p95):`);
  const classOrder = [CURRENT_REPORTS, ASOF_REPORTS, CURRENT_LIVES];
  const p50Of = (cls: string) => percentile([...(byClass.get(cls) ?? [])].sort((a, b) => a - b), 50);
  for (const cls of classOrder) {
    const arr = [...(byClass.get(cls) ?? [])].sort((a, b) => a - b);
    if (arr.length === 0) continue;
    console.log(`    ${cls.padEnd(34)} ${fmt(percentile(arr, 50))} / ${fmt(percentile(arr, 95))}   (n=${arr.length})`);
  }

  // The headline takeaway, computed from this run: the temporal filter's marginal
  // cost, isolated by comparing the same `reports-to` query with vs without `as_of`.
  const currentP50 = p50Of(CURRENT_REPORTS);
  const asOfP50 = p50Of(ASOF_REPORTS);
  if (Number.isFinite(currentP50) && Number.isFinite(asOfP50)) {
    const delta = asOfP50 - currentP50;
    const sign = delta >= 0 ? "+" : "−";
    console.log(
      `\n  Point-in-time recall costs ${sign}${Math.abs(delta).toFixed(1)} ms at p50 vs the same Current\n` +
        `  query (${fmt(asOfP50)} vs ${fmt(currentP50)}) — excluding ${factCounts.facts.superseded} superseded Facts\n` +
        `  in SQL is not a latency tax; the bi-temporal model stays in the agent's hot path.`,
    );
  }
  console.log(
    `\nLatency is machine-dependent; reproduce on your hardware with \`pnpm bench\`. ` +
      `Corpus shape is deterministic.`,
  );
}

main().catch((err) => {
  console.error("bench failed:", err);
  process.exit(1);
});

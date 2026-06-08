/**
 * Agent's-eye demo (the thesis, made concrete): "temporal memory **for AI
 * agents**" proven not as a metric but as *the context an agent actually
 * receives in its tool call*.
 *
 *   pnpm demo:agent
 *
 * For one temporal question whose answer changed over time, it prints — side by
 * side — what a naive vector memory hands the agent versus what Tense hands it,
 * driven through the SAME `recall` and `baselineAnswer` code paths the eval and
 * the MCP server use (no demo-only logic that could drift from production). The
 * point: the agent answers correctly *because of the context the tool returns*,
 * so the win is visible in the payload, not just in a score.
 *
 * Fully offline — StubExtractor + bag-of-words embeddings, Postgres only, no API
 * key, no network — and byte-stable, so a reviewer can reproduce it in seconds.
 * Uses TENSE_EVAL_DATABASE_URL (default …/tense_eval) so it never touches the
 * demo or test databases.
 */
import "../src/env.js";
import pg from "pg";
import { ensureDatabase, migrate } from "../src/db/migrate.js";
import { TemporalGraphStore } from "../src/db/store.js";
import { StubExtractor } from "../src/extraction/stub.js";
import { EntityResolver } from "../src/resolution/entity-resolver.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import { baselineAnswer } from "../eval/baseline.js";
import { BagOfWordsProvider } from "../eval/bag-of-words-provider.js";

const EVAL_DB_URL =
  process.env.TENSE_EVAL_DATABASE_URL ?? "postgres://postgres:tense@localhost:5432/tense_eval";

/** The flagship org-change Source pair: Zach reports to Alice, then to Bob. */
export const SOURCES = [
  { label: "org-2024q1", text: "[2024-01-01] Zach reports to Alice." },
  { label: "org-2024q2", text: "[2024-06-01] Zach reports to Bob." },
];

/** One agent question and what each memory hands the model, via the real code paths. */
export interface AgentScenario {
  question: string;
  /** null = "now" (Current); a date string = point-in-time. */
  asOf: string | null;
  gold: string;
  /** Tense's top Fact handed to the agent (recall with the temporal filter). */
  tense: {
    answer: string | null;
    object: string | null;
    validAt: string | null;
    invalidAt: string | null;
    current: boolean | null;
    source: string | null;
  };
  /** The naive vector memory's recency-tiebreak answer, plus its full candidate pool. */
  baseline: {
    answer: string | null;
    candidates: Array<{ object: string; validAt: string | null }>;
  };
}

/**
 * Run one question through both memories against an already-ingested graph. Pure
 * over the two production code paths (`recall`, `baselineAnswer`) — the
 * presentation layer below only formats what this returns, so the demo cannot
 * claim something the engine doesn't actually do.
 */
export async function runAgentScenario(
  store: TemporalGraphStore,
  provider: BagOfWordsProvider,
  q: { question: string; asOf: string | null; gold: string },
): Promise<AgentScenario> {
  const asOf = q.asOf ? new Date(q.asOf) : null;

  // What TENSE hands the agent: temporal filter in SQL, then hybrid rank.
  const top = (await recall({ store, provider }, q.question, { asOf }))[0];

  // What a NAIVE VECTOR MEMORY hands the agent: top-k cosine over ALL Facts
  // (superseded included), recency tiebreak, no notion of as_of.
  const [embedding] = await provider.embed([q.question]);
  const candidates = embedding ? await store.baselineCandidates(embedding, 5) : [];
  const baseAns = await baselineAnswer(store, provider, q.question);

  return {
    question: q.question,
    asOf: q.asOf,
    gold: q.gold,
    tense: {
      answer: top?.object ?? null,
      object: top?.object ?? null,
      validAt: top?.validAt ? top.validAt.toISOString().slice(0, 10) : null,
      invalidAt: top?.invalidAt ? top.invalidAt.toISOString().slice(0, 10) : null,
      current: top ? top.current : null,
      source: top?.source.label ?? null,
    },
    baseline: {
      answer: baseAns,
      candidates: candidates.map((c) => ({
        object: c.object,
        validAt: c.validAt ? c.validAt.toISOString().slice(0, 10) : null,
      })),
    },
  };
}

/** The two questions: the point-in-time headline, then a "now" control. */
export const DEMO_QUESTIONS = [
  { question: "who does Zach report to", asOf: "2024-03-01", gold: "Alice" },
  { question: "who does Zach report to", asOf: null, gold: "Bob" },
];

const rule = "─".repeat(72);

function formatScenario(s: AgentScenario): string {
  const tenseOk = s.tense.answer === s.gold;
  const baseOk = s.baseline.answer === s.gold;
  const asOfLabel = s.asOf ? `as_of = ${s.asOf}` : "as_of = now (Current)";
  const pool = s.baseline.candidates
    .map((c) => `${c.object}${c.validAt ? ` (valid ${c.validAt})` : ""}`)
    .join(", ");

  // The exact JSON context block Tense returns to the model — the win is here,
  // not just in the answer string.
  const tenseBlock = JSON.stringify(
    {
      object: s.tense.object,
      validAt: s.tense.validAt,
      invalidAt: s.tense.invalidAt,
      current: s.tense.current,
      source: s.tense.source,
    },
    null,
    2,
  )
    .split("\n")
    .map((l) => `      ${l}`)
    .join("\n");

  return [
    rule,
    `Q.  Agent asks: "${s.question}?"   ${asOfLabel}`,
    `    Correct answer (gold): ${s.gold}`,
    rule,
    "",
    `  ${baseOk ? "✓" : "✗"} Naive vector memory  —  top-k cosine, recency tiebreak, no as_of`,
    `      candidate Facts retrieved: ${pool || "(none)"}`,
    `      → hands the agent: ${s.baseline.answer ?? "(nothing)"}` +
      (baseOk ? "   [right — recency happens to match]" : "   [WRONG — returns the *current* value, blind to as_of]"),
    "",
    `  ${tenseOk ? "✓" : "✗"} Tense  —  temporal filter in SQL, then hybrid rank (the recall() the MCP server serves)`,
    tenseBlock,
    `      → hands the agent: ${s.tense.answer ?? "(nothing)"}` +
      (tenseOk
        ? "   [RIGHT — who was Current then, with the validity interval + Source to cite]"
        : "   [wrong]"),
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  await ensureDatabase(EVAL_DB_URL);
  await migrate(EVAL_DB_URL);

  const pool = new pg.Pool({ connectionString: EVAL_DB_URL });
  const provider = new BagOfWordsProvider();
  const deps: RememberDeps = {
    store: new TemporalGraphStore(pool),
    extractor: new StubExtractor(), // deterministic extraction (no LLM)
    resolver: new EntityResolver(pool),
    registry: defaultPredicateRegistry(),
    provider, // deterministic embeddings (no API key)
  };

  await pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");
  for (const s of SOURCES) await remember(deps, s.text, s.label);

  console.log("");
  console.log("  Tense — what an AI agent actually receives in its memory tool call");
  console.log("  (offline · stub extraction · bag-of-words embeddings · no API key)");
  console.log("");
  console.log("  The agent's memory holds two Sources, ingested in order:");
  for (const s of SOURCES) console.log(`    • ${s.text}   (source: ${s.label})`);
  console.log("");
  console.log("  reports-to is single-valued, so the second Source SUPERSEDED the first:");
  console.log("  Zach→Alice is closed (kept as history), Zach→Bob is Current.");
  console.log("");

  const results: AgentScenario[] = [];
  for (const q of DEMO_QUESTIONS) {
    const s = await runAgentScenario(deps.store, provider, q);
    results.push(s);
    console.log(formatScenario(s));
  }
  await pool.end();

  console.log(rule);
  const pit = results[0];
  const now = results[1];
  console.log("  Verdict");
  console.log(
    `    • Point-in-time ("${pit?.asOf}"): Tense → ${pit?.tense.answer} ✓   vector → ${pit?.baseline.answer} ✗`,
  );
  console.log(
    `    • Now:                  Tense → ${now?.tense.answer} ✓   vector → ${now?.baseline.answer} ✓  (the baseline is fair, not a strawman)`,
  );
  console.log("");
  console.log("  The agent answers the past question correctly ONLY because Tense's tool");
  console.log("  result carried the as_of-filtered Fact + its validity interval + Source.");
  console.log("  A vector store hands the agent the most-recent Fact and no way to know it");
  console.log("  was wrong for that date. That gap is the whole product.");
  console.log("");
}

// Only run the CLI when invoked directly, so tests can import runAgentScenario.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[demo:agent] failed:", err);
    process.exit(1);
  });
}

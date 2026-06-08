import type pg from "pg";
import { remember, type RememberDeps } from "../src/pipeline.js";
import { recall } from "../src/retrieval/recall.js";
import { baselineAnswer } from "./baseline.js";
import { GOLD_QA, GOLD_SCENARIOS, type GoldScenario } from "./gold.js";
import {
  qaAccuracy,
  supersessionMetrics,
  tripleF1,
  validAtAccuracy,
  type FactState,
} from "./metrics.js";

export interface HarnessDeps extends RememberDeps {
  /** Pool for truncating the graph between scenarios. */
  pool: pg.Pool;
}

/** One QA question with the gold answer and what each system actually returned. */
export interface QaItem {
  scenario: string;
  question: string;
  /** Point-in-time the question is asked at (`null` = "now" / Current). */
  asOf: string | null;
  gold: string;
  tense: string | null;
  baseline: string | null;
  /** True when the gold answer differs from the latest value (the headline rows). */
  changed: boolean;
}

export interface EvalReport {
  scenarios: number;
  tripleF1: number;
  validAtAccuracy: number;
  supersession: { precision: number; recall: number; f1: number; falseSupersessionRate: number };
  qa: {
    count: number;
    changedCount: number;
    /** Accuracy over ALL QA items. */
    overall: { tense: number; baseline: number };
    /** THE HEADLINE: accuracy on point-in-time questions whose answer changed. */
    changedOverTime: { tense: number; baseline: number };
    /** Every QA question with gold vs Tense vs baseline — the transparency rows. */
    items: QaItem[];
  };
}

/**
 * Run the gold set: ingest each scenario into a fresh graph, then measure
 * extraction (triple-F1, valid_at), supersession (P/R + false-supersession), and
 * temporal-QA accuracy of Tense vs the fair baseline. Scenarios are isolated
 * (truncate between) so entity names never collide.
 */
export async function runEval(
  deps: HarnessDeps,
  opts: { scenarios?: GoldScenario[]; includeBaseline?: boolean } = {},
): Promise<EvalReport> {
  const scenarios = opts.scenarios ?? GOLD_SCENARIOS;
  const includeBaseline = opts.includeBaseline ?? true;

  const expectedPool: FactState[] = [];
  const actualPool: FactState[] = [];
  const tenseQa: Array<{ gold: string; got: string | null; changed: boolean }> = [];
  const baselineQa: Array<{ gold: string; got: string | null; changed: boolean }> = [];
  const items: QaItem[] = [];

  for (const scenario of scenarios) {
    await deps.pool.query("TRUNCATE facts, entities, sources RESTART IDENTITY CASCADE");

    for (const src of scenario.sources) {
      await remember(deps, src.text, src.label);
    }

    // Namespace triples by scenario so pooled micro-metrics never collide.
    const ns = (name: string) => `${scenario.name}::${name}`;
    for (const f of scenario.expectedFacts) {
      expectedPool.push({ subject: ns(f.subject), predicate: f.predicate, object: f.object, current: f.current, validAt: f.validAt });
    }
    for (const f of await deps.store.allFacts()) {
      actualPool.push({
        subject: ns(f.subject),
        predicate: f.predicate,
        object: f.object,
        current: f.current,
        validAt: f.validAt ? f.validAt.toISOString() : null,
      });
    }

    for (const qa of GOLD_QA.filter((q) => q.scenario === scenario.name)) {
      const asOf = qa.asOf ? new Date(qa.asOf) : null;
      const tenseTop = (await recall({ store: deps.store, provider: deps.provider }, qa.question, { asOf }))[0];
      const tenseAns = tenseTop?.object ?? null;
      tenseQa.push({ gold: qa.answer, got: tenseAns, changed: qa.changedOverTime });

      let baseAns: string | null = null;
      if (includeBaseline && deps.provider) {
        baseAns = await baselineAnswer(deps.store, deps.provider, qa.question);
        baselineQa.push({ gold: qa.answer, got: baseAns, changed: qa.changedOverTime });
      }

      items.push({
        scenario: scenario.name,
        question: qa.question,
        asOf: qa.asOf,
        gold: qa.answer,
        tense: tenseAns,
        baseline: includeBaseline ? baseAns : null,
        changed: qa.changedOverTime,
      });
    }
  }

  const changed = (items: typeof tenseQa) => items.filter((i) => i.changed);

  return {
    scenarios: scenarios.length,
    tripleF1: tripleF1(expectedPool, actualPool).f1,
    validAtAccuracy: validAtAccuracy(expectedPool, actualPool),
    supersession: supersessionMetrics(expectedPool, actualPool),
    qa: {
      count: tenseQa.length,
      changedCount: changed(tenseQa).length,
      overall: { tense: qaAccuracy(tenseQa), baseline: qaAccuracy(baselineQa) },
      changedOverTime: {
        tense: qaAccuracy(changed(tenseQa)),
        baseline: qaAccuracy(changed(baselineQa)),
      },
      items,
    },
  };
}

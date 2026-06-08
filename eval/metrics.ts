/**
 * Pure eval metrics (slice 13) — computed from expected vs actual data so they
 * are deterministic and unit-testable with fixed oracles. No DB, no model.
 */

export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

export interface FactState extends Triple {
  current: boolean;
  validAt: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();
const tripleKey = (t: Triple) => `${norm(t.subject)}|${norm(t.predicate)}|${norm(t.object)}`;

export interface PRF {
  precision: number;
  recall: number;
  f1: number;
}

/** Triple-level extraction F1 (subject/predicate/object exact match, normalized). */
export function tripleF1(expected: Triple[], actual: Triple[]): PRF {
  const exp = new Set(expected.map(tripleKey));
  const act = new Set(actual.map(tripleKey));
  let tp = 0;
  for (const k of act) if (exp.has(k)) tp++;
  const precision = act.size ? tp / act.size : expected.length === 0 ? 1 : 0;
  const recall = exp.size ? tp / exp.size : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

export interface SupersessionMetrics extends PRF {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** # Facts the gold set says should stay Current — the false-supersession denominator. */
  shouldStayCurrent: number;
  /** FP / (# Facts that should have stayed Current) — the "forgot a true Fact" rate. */
  falseSupersessionRate: number;
}

/**
 * Supersession precision/recall + false-supersession rate. A Fact is "superseded"
 * when `current === false`. Matched by triple:
 *   TP — should be superseded AND is superseded
 *   FP — should stay Current BUT was superseded (false supersession)
 *   FN — should be superseded BUT is still Current (or absent)
 */
export function supersessionMetrics(expected: FactState[], actual: FactState[]): SupersessionMetrics {
  const actualByKey = new Map(actual.map((f) => [tripleKey(f), f]));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let shouldStayCurrent = 0;

  for (const exp of expected) {
    const got = actualByKey.get(tripleKey(exp));
    if (!exp.current) {
      // should be superseded
      if (got && !got.current) tp++;
      else fn++;
    } else {
      shouldStayCurrent++;
      if (got && !got.current) fp++; // closed a still-true Fact
    }
  }

  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const falseSupersessionRate = shouldStayCurrent ? fp / shouldStayCurrent : 0;

  return { precision, recall, f1, truePositives: tp, falsePositives: fp, falseNegatives: fn, shouldStayCurrent, falseSupersessionRate };
}

/** Fraction of matched triples whose extracted valid_at matches the gold. */
export function validAtAccuracy(expected: FactState[], actual: FactState[]): number {
  const actualByKey = new Map(actual.map((f) => [tripleKey(f), f]));
  let matched = 0;
  let correct = 0;
  for (const exp of expected) {
    const got = actualByKey.get(tripleKey(exp));
    if (!got) continue;
    matched++;
    const gotDate = got.validAt ? got.validAt.slice(0, 10) : null;
    if (gotDate === exp.validAt) correct++;
  }
  return matched ? correct / matched : 1;
}

/** QA accuracy: fraction of items whose answer matches the gold (normalized). */
export function qaAccuracy(items: Array<{ gold: string; got: string | null }>): number {
  if (items.length === 0) return 1;
  const hits = items.filter((i) => i.got !== null && norm(i.got) === norm(i.gold)).length;
  return hits / items.length;
}

/**
 * Full gold eval set (slice 11) — the oracle for every quantitative claim:
 * extraction quality (triple-F1, valid_at accuracy), supersession precision/
 * recall incl. false-supersession, and the headline temporal-QA chart.
 *
 * Scenarios are phrased in a simple grammar with explicit "[YYYY-MM-DD]" valid
 * dates so they are deterministically extractable by the stub (for a CI-safe
 * harness test) AND natural enough for the LLM extractor (for the real numbers).
 *
 * Coverage (asserted by the slice-11 well-formedness test): null valid_at, tied
 * valid_at, out-of-order ingestion, and "still-true" Facts that must NOT be
 * superseded (so false-supersession rate is measurable).
 *
 * AFK-authored from the canonical demo; HITL review/expansion to ~30 pending.
 */

export type GoldTag =
  | "supersession"
  | "still-true"
  | "null-valid-at"
  | "tied-valid-at"
  | "out-of-order"
  | "multi-valued"
  | "cross-predicate"
  | "llm-only"
  | "changed-over-time";

export interface GoldFact {
  subject: string;
  predicate: string;
  object: string;
  validAt: string | null;
  /** Expected Current state after ALL the scenario's Sources are ingested. */
  current: boolean;
}

export interface GoldScenario {
  name: string;
  tags: GoldTag[];
  /** Ingested in array order. */
  sources: Array<{ label: string; text: string }>;
  expectedFacts: GoldFact[];
}

export interface GoldQa {
  scenario: string;
  question: string;
  /** ISO date for a point-in-time question; null = "now". */
  asOf: string | null;
  /** The single unambiguous gold answer (object Entity name). */
  answer: string;
  /** True when the answer differs from the current answer (baseline can't win). */
  changedOverTime: boolean;
}

export const GOLD_SCENARIOS: GoldScenario[] = [
  {
    name: "reports-to org change (dated)",
    tags: ["supersession", "changed-over-time"],
    sources: [
      { label: "org-2024q1", text: "[2024-01-01] Zach reports to Alice." },
      { label: "org-2024q2", text: "[2024-06-01] Zach reports to Bob." },
    ],
    expectedFacts: [
      { subject: "Zach", predicate: "reports-to", object: "Alice", validAt: "2024-01-01", current: false },
      { subject: "Zach", predicate: "reports-to", object: "Bob", validAt: "2024-06-01", current: true },
    ],
  },
  {
    name: "lives-in move (dated)",
    tags: ["supersession", "changed-over-time"],
    sources: [
      { label: "mia-1", text: "[2022-03-01] Mia lives in Berlin." },
      { label: "mia-2", text: "[2024-09-01] Mia lives in Munich." },
    ],
    expectedFacts: [
      { subject: "Mia", predicate: "lives-in", object: "Berlin", validAt: "2022-03-01", current: false },
      { subject: "Mia", predicate: "lives-in", object: "Munich", validAt: "2024-09-01", current: true },
    ],
  },
  {
    name: "null valid_at supersession (prose 'now')",
    tags: ["supersession", "null-valid-at"],
    sources: [
      { label: "sam-1", text: "[2023-01-01] Sam reports to Dana." },
      // No date -> null valid_at; supersedes via the transaction-time fallback.
      { label: "sam-2", text: "Sam reports to Priya." },
    ],
    expectedFacts: [
      { subject: "Sam", predicate: "reports-to", object: "Dana", validAt: "2023-01-01", current: false },
      { subject: "Sam", predicate: "reports-to", object: "Priya", validAt: null, current: true },
    ],
  },
  {
    name: "out-of-order ingestion (older arrives second)",
    tags: ["supersession", "out-of-order"],
    sources: [
      { label: "ron-new", text: "[2024-06-01] Ron reports to Bea." },
      { label: "ron-old", text: "[2024-01-01] Ron reports to Ada." },
    ],
    expectedFacts: [
      // Ada is older -> born already-expired; Bea (newer) stays Current.
      { subject: "Ron", predicate: "reports-to", object: "Ada", validAt: "2024-01-01", current: false },
      { subject: "Ron", predicate: "reports-to", object: "Bea", validAt: "2024-06-01", current: true },
    ],
  },
  {
    name: "tied valid_at (transaction-time tiebreak)",
    tags: ["supersession", "tied-valid-at"],
    sources: [
      { label: "tess-1", text: "[2024-05-01] Tess reports to Omar." },
      { label: "tess-2", text: "[2024-05-01] Tess reports to Nina." },
    ],
    expectedFacts: [
      // Same valid_at -> later-ingested (Nina) wins.
      { subject: "Tess", predicate: "reports-to", object: "Omar", validAt: "2024-05-01", current: false },
      { subject: "Tess", predicate: "reports-to", object: "Nina", validAt: "2024-05-01", current: true },
    ],
  },
  {
    name: "multi-valued knows (still true, must not supersede)",
    tags: ["still-true", "multi-valued"],
    sources: [
      { label: "zoe-1", text: "[2024-01-01] Zoe knows Ann." },
      { label: "zoe-2", text: "[2024-02-01] Zoe knows Ben." },
      { label: "zoe-3", text: "[2024-03-01] Zoe knows Cal." },
    ],
    expectedFacts: [
      { subject: "Zoe", predicate: "knows", object: "Ann", validAt: "2024-01-01", current: true },
      { subject: "Zoe", predicate: "knows", object: "Ben", validAt: "2024-02-01", current: true },
      { subject: "Zoe", predicate: "knows", object: "Cal", validAt: "2024-03-01", current: true },
    ],
  },
  {
    name: "distinct subjects on a single-valued predicate (must not cross-supersede)",
    tags: ["still-true"],
    sources: [
      { label: "x1", text: "[2024-01-01] Ivy reports to Leo." },
      { label: "x2", text: "[2024-02-01] Jay reports to Mae." },
    ],
    expectedFacts: [
      { subject: "Ivy", predicate: "reports-to", object: "Leo", validAt: "2024-01-01", current: true },
      { subject: "Jay", predicate: "reports-to", object: "Mae", validAt: "2024-02-01", current: true },
    ],
  },
  {
    name: "contributed-to multi-valued (still true)",
    tags: ["still-true", "multi-valued"],
    sources: [
      { label: "k1", text: "[2023-11-01] Kim contributed to Tense." },
      { label: "k2", text: "[2024-01-01] Kim contributed to Atlas." },
    ],
    expectedFacts: [
      { subject: "Kim", predicate: "contributed-to", object: "Tense", validAt: "2023-11-01", current: true },
      { subject: "Kim", predicate: "contributed-to", object: "Atlas", validAt: "2024-01-01", current: true },
    ],
  },
  {
    name: "three-step reports-to chain (dated)",
    tags: ["supersession", "changed-over-time"],
    sources: [
      { label: "e1", text: "[2021-01-01] Eli reports to Pat." },
      { label: "e2", text: "[2022-01-01] Eli reports to Quinn." },
      { label: "e3", text: "[2023-01-01] Eli reports to Remy." },
    ],
    expectedFacts: [
      { subject: "Eli", predicate: "reports-to", object: "Pat", validAt: "2021-01-01", current: false },
      { subject: "Eli", predicate: "reports-to", object: "Quinn", validAt: "2022-01-01", current: false },
      { subject: "Eli", predicate: "reports-to", object: "Remy", validAt: "2023-01-01", current: true },
    ],
  },
  {
    name: "cross-predicate works-at then left (LLM-judged path)",
    tags: ["cross-predicate", "supersession", "llm-only"],
    sources: [
      { label: "a1", text: "[2020-01-01] Alice works at Acme." },
      { label: "a2", text: "[2024-01-01] Alice left Acme." },
    ],
    expectedFacts: [
      { subject: "Alice", predicate: "works-at", object: "Acme", validAt: "2020-01-01", current: false },
      { subject: "Alice", predicate: "left", object: "Acme", validAt: "2024-01-01", current: true },
    ],
  },
];

export const GOLD_QA: GoldQa[] = [
  // Point-in-time questions whose answer changed over time — where a recency-sorted
  // baseline cannot win.
  { scenario: "reports-to org change (dated)", question: "Who does Zach report to?", asOf: null, answer: "Bob", changedOverTime: false },
  { scenario: "reports-to org change (dated)", question: "Who does Zach report to?", asOf: "2024-03-01", answer: "Alice", changedOverTime: true },
  { scenario: "lives-in move (dated)", question: "Where does Mia live?", asOf: null, answer: "Munich", changedOverTime: false },
  { scenario: "lives-in move (dated)", question: "Where does Mia live?", asOf: "2023-01-01", answer: "Berlin", changedOverTime: true },
  { scenario: "null valid_at supersession (prose 'now')", question: "Who does Sam report to?", asOf: null, answer: "Priya", changedOverTime: false },
  { scenario: "out-of-order ingestion (older arrives second)", question: "Who does Ron report to?", asOf: null, answer: "Bea", changedOverTime: false },
  { scenario: "out-of-order ingestion (older arrives second)", question: "Who does Ron report to?", asOf: "2024-03-01", answer: "Ada", changedOverTime: true },
  { scenario: "tied valid_at (transaction-time tiebreak)", question: "Who does Tess report to?", asOf: null, answer: "Nina", changedOverTime: false },
  { scenario: "three-step reports-to chain (dated)", question: "Who does Eli report to?", asOf: null, answer: "Remy", changedOverTime: false },
  { scenario: "three-step reports-to chain (dated)", question: "Who does Eli report to?", asOf: "2021-06-01", answer: "Pat", changedOverTime: true },
  { scenario: "three-step reports-to chain (dated)", question: "Who does Eli report to?", asOf: "2022-06-01", answer: "Quinn", changedOverTime: true },
];

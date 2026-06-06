/**
 * Smoke gold set (slice 04) — a small, hand-curated set of Sources with the
 * Entities/Facts a correct extraction should produce. Used to sanity-check
 * extraction quality (slice 05) before the full eval set (slice 11).
 *
 * Coverage (asserted by the slice-04 well-formedness test):
 *   - ≥1 supersession scenario (a Source that should retire a prior Fact)
 *   - ≥1 null-valid_at scenario (prose with no extractable date)
 *
 * AFK-authored from the canonical demo; HITL quality sign-off pending.
 */

export interface GoldFact {
  subject: string;
  predicate: string;
  object: string;
  /** Expected valid_at as ISO date, or null when the Source states no date. */
  validAt: string | null;
}

export interface GoldScenario {
  name: string;
  source: string;
  expectedEntities: string[];
  expectedFacts: GoldFact[];
  tags: Array<"baseline" | "supersession" | "null-valid-at" | "dated" | "multi-predicate" | "cross-predicate">;
}

export const SMOKE_GOLD: GoldScenario[] = [
  {
    name: "reports-to baseline (no date)",
    source: "Zach reports to Alice.",
    expectedEntities: ["Zach", "Alice"],
    expectedFacts: [{ subject: "Zach", predicate: "reports-to", object: "Alice", validAt: null }],
    tags: ["baseline", "null-valid-at"],
  },
  {
    name: "reports-to with an explicit date",
    source: "On 2024-06-01, Zach started reporting to Bob.",
    expectedEntities: ["Zach", "Bob"],
    expectedFacts: [{ subject: "Zach", predicate: "reports-to", object: "Bob", validAt: "2024-06-01" }],
    tags: ["dated"],
  },
  {
    name: "org change (supersession, null valid_at)",
    source: "Zach now reports to Carol.",
    expectedEntities: ["Zach", "Carol"],
    expectedFacts: [{ subject: "Zach", predicate: "reports-to", object: "Carol", validAt: null }],
    tags: ["supersession", "null-valid-at"],
  },
  {
    name: "multiple predicates in one Source",
    source: "Dana lives in Berlin and knows Alice.",
    expectedEntities: ["Dana", "Berlin", "Alice"],
    expectedFacts: [
      { subject: "Dana", predicate: "lives-in", object: "Berlin", validAt: null },
      { subject: "Dana", predicate: "knows", object: "Alice", validAt: null },
    ],
    tags: ["multi-predicate", "null-valid-at"],
  },
  {
    name: "cross-predicate contradiction (works-at vs left)",
    source: "Alice left Acme.",
    expectedEntities: ["Alice", "Acme"],
    expectedFacts: [{ subject: "Alice", predicate: "left", object: "Acme", validAt: null }],
    tags: ["supersession", "cross-predicate", "null-valid-at"],
  },
];

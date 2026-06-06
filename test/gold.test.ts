import { describe, expect, it } from "vitest";
import { GOLD_QA, GOLD_SCENARIOS } from "../eval/gold.js";

// Slice 11: validate the full gold set is well-formed and covers the hard cases.
describe("full gold eval set", () => {
  it("every scenario is well-formed", () => {
    for (const s of GOLD_SCENARIOS) {
      expect(s.name).toBeTruthy();
      expect(s.sources.length).toBeGreaterThan(0);
      expect(s.expectedFacts.length).toBeGreaterThan(0);
      for (const f of s.expectedFacts) {
        expect(f.subject && f.predicate && f.object).toBeTruthy();
        if (f.validAt !== null) expect(f.validAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof f.current).toBe("boolean");
      }
    }
  });

  it("covers the hard cases: null/tied/out-of-order valid_at and still-true", () => {
    const tags = new Set(GOLD_SCENARIOS.flatMap((s) => s.tags));
    expect(tags.has("null-valid-at")).toBe(true);
    expect(tags.has("tied-valid-at")).toBe(true);
    expect(tags.has("out-of-order")).toBe(true);
    expect(tags.has("still-true")).toBe(true); // false-supersession must be measurable
  });

  it("includes point-in-time questions whose answer changed over time", () => {
    const changed = GOLD_QA.filter((q) => q.changedOverTime && q.asOf !== null);
    expect(changed.length).toBeGreaterThanOrEqual(3);
    for (const q of changed) {
      expect(q.answer).toBeTruthy();
      expect(GOLD_SCENARIOS.some((s) => s.name === q.scenario)).toBe(true);
    }
  });

  it("every QA item references a real scenario and has a single gold answer", () => {
    for (const q of GOLD_QA) {
      expect(GOLD_SCENARIOS.some((s) => s.name === q.scenario)).toBe(true);
      expect(q.answer.trim().length).toBeGreaterThan(0);
    }
  });
});

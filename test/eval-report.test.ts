import { describe, expect, it } from "vitest";
import type { EvalReport, QaItem } from "../eval/harness.js";
import { renderQaBreakdown, renderResultsMarkdown } from "../eval/report.js";

const qa = (over: Partial<QaItem>): QaItem => ({
  scenario: "reports-to org change (dated)",
  question: "Who does Zach report to?",
  asOf: null,
  gold: "Bob",
  tense: "Bob",
  baseline: "Bob",
  changed: false,
  ...over,
});

// A tiny synthetic report: one "now" question both get right, one point-in-time
// question only Tense gets right (the headline shape).
const report: EvalReport = {
  scenarios: 1,
  tripleF1: 1,
  validAtAccuracy: 1,
  supersession: {
    precision: 1,
    recall: 1,
    f1: 1,
    truePositives: 3,
    falsePositives: 0,
    falseNegatives: 0,
    shouldStayCurrent: 4,
    falseSupersessionRate: 0,
  },
  qa: {
    count: 2,
    changedCount: 1,
    overall: { tense: 1, baseline: 0.5 },
    changedOverTime: { tense: 1, baseline: 0 },
    items: [
      qa({}),
      qa({ asOf: "2024-03-01", gold: "Alice", tense: "Alice", baseline: "Bob", changed: true }),
    ],
  },
  coverage: [
    { tag: "supersession", scenarios: ["reports-to org change (dated)"] },
    { tag: "changed-over-time", scenarios: ["reports-to org change (dated)"] },
    { tag: "still-true", scenarios: ["multi-valued knows (still true, must not supersede)"] },
  ],
};

describe("eval report renderer (pure, deterministic)", () => {
  it("marks a correct answer ✓ and a wrong one ✗", () => {
    const md = renderResultsMarkdown(report);
    // The point-in-time row: Tense right (Alice ✓), baseline wrong (Bob ✗).
    expect(md).toContain("| Alice | Alice ✓ | Bob ✗ |");
    // The "now" row: both right.
    expect(md).toContain("| Bob | Bob ✓ | Bob ✓ |");
  });

  it("headline table lists only the changed-over-time questions", () => {
    const md = renderResultsMarkdown(report);
    const headline = md.split("## Every question")[0];
    expect(headline).toContain("`2024-03-01`");
    expect(headline).not.toContain("`now`"); // the now-question is below, not in the headline
  });

  it("reconciles the summary numbers with the report (no drift)", () => {
    const md = renderResultsMarkdown(report);
    expect(md).toContain("point-in-time (1 questions)** | **100.0%** | **0.0%**");
    expect(md).toContain("all questions (2) | 100.0% | 50.0%");
  });

  it("surfaces the supersession denominators, not just the percentages", () => {
    const md = renderResultsMarkdown(report);
    // "100%" must reconcile against an auditable count, not stand alone.
    expect(md).toContain("3 / 3 gold closures caught"); // recall: TP / (TP+FN)
    expect(md).toContain("3 / 3 closures correct"); // precision: TP / (TP+FP)
    expect(md).toContain("0 / 4 still-true Facts closed"); // false-supersession: FP / shouldStayCurrent
  });

  it("is byte-identical across renders (deterministic — no clock/random)", () => {
    expect(renderResultsMarkdown(report)).toBe(renderResultsMarkdown(report));
  });

  it("renders the coverage matrix in the curated order with per-tag scenario counts", () => {
    const md = renderResultsMarkdown(report);
    expect(md).toContain("## What the gold set deliberately tests");
    // changed-over-time precedes supersession (TAG_ORDER), regardless of input order.
    const changedIdx = md.indexOf("**Answer changed over time**");
    const supersedeIdx = md.indexOf("**Supersession fires**");
    expect(changedIdx).toBeGreaterThan(-1);
    expect(changedIdx).toBeLessThan(supersedeIdx);
    // Count comes from the coverage entry, and the still-true tally is called out.
    expect(md).toContain("| **Must NOT supersede** |");
    expect(md).toContain('1 are "still-true" cases');
  });

  it("terminal breakdown shows each point-in-time question with both answers", () => {
    const out = renderQaBreakdown(report);
    expect(out).toContain("Who does Zach report to?");
    expect(out).toContain("gold=Alice");
    expect(out).toContain("baseline=Bob ✗");
  });
});

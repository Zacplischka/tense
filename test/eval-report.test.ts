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
  supersession: { precision: 1, recall: 1, f1: 1, falseSupersessionRate: 0 },
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

  it("is byte-identical across renders (deterministic — no clock/random)", () => {
    expect(renderResultsMarkdown(report)).toBe(renderResultsMarkdown(report));
  });

  it("terminal breakdown shows each point-in-time question with both answers", () => {
    const out = renderQaBreakdown(report);
    expect(out).toContain("Who does Zach report to?");
    expect(out).toContain("gold=Alice");
    expect(out).toContain("baseline=Bob ✗");
  });
});

import { describe, expect, it } from "vitest";
import {
  qaAccuracy,
  supersessionMetrics,
  tripleF1,
  validAtAccuracy,
  type FactState,
} from "../eval/metrics.js";

const t = (subject: string, object: string) => ({ subject, predicate: "reports-to", object });
const fs = (object: string, current: boolean, validAt: string | null): FactState => ({
  subject: "Zach",
  predicate: "reports-to",
  object,
  current,
  validAt,
});

describe("eval metrics", () => {
  it("tripleF1 rewards exact triples and penalizes misses/extras", () => {
    const exact = tripleF1([t("Zach", "Bob")], [t("Zach", "Bob")]);
    expect(exact.f1).toBe(1);

    const partial = tripleF1([t("Zach", "Bob"), t("Mia", "Ann")], [t("Zach", "Bob")]);
    expect(partial.recall).toBe(0.5);
    expect(partial.precision).toBe(1);
  });

  it("supersession: counts a correct close as TP, never an FP", () => {
    const expected = [fs("Alice", false, "2024-01-01"), fs("Bob", true, "2024-06-01")];
    const actual = [fs("Alice", false, "2024-01-01"), fs("Bob", true, "2024-06-01")];
    const m = supersessionMetrics(expected, actual);
    expect(m.truePositives).toBe(1);
    expect(m.falsePositives).toBe(0);
    expect(m.recall).toBe(1);
    expect(m.falseSupersessionRate).toBe(0);
  });

  it("supersession: flags a false supersession when a still-true Fact is closed", () => {
    const expected = [fs("Alice", true, "2024-01-01"), fs("Bob", true, "2024-06-01")]; // both should stay
    const actual = [fs("Alice", false, "2024-01-01"), fs("Bob", true, "2024-06-01")]; // Alice wrongly closed
    const m = supersessionMetrics(expected, actual);
    expect(m.falsePositives).toBe(1);
    expect(m.falseSupersessionRate).toBe(0.5); // 1 of 2 should-stay-current Facts
  });

  it("validAtAccuracy compares the date portion of matched triples", () => {
    const expected = [fs("Bob", true, "2024-06-01")];
    const right = validAtAccuracy(expected, [fs("Bob", true, "2024-06-01T00:00:00.000Z")]);
    expect(right).toBe(1);
    const wrong = validAtAccuracy(expected, [fs("Bob", true, "2023-01-01")]);
    expect(wrong).toBe(0);
  });

  it("qaAccuracy matches answers case-insensitively", () => {
    expect(qaAccuracy([{ gold: "Alice", got: "alice" }, { gold: "Bob", got: "Carol" }])).toBe(0.5);
    expect(qaAccuracy([{ gold: "Alice", got: null }])).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { snapshotAsOf, type Snapshot } from "../viewer/lib/graph-model.js";

/**
 * Pure point-in-time derivation behind the viewer's as-of scrubber: keep only
 * Facts VALID at the instant (half-open valid_at <= T < invalid_at), each shown
 * as the truth-then (Current).
 */
const snapshot: Snapshot = {
  entities: [
    { id: "zach", name: "Zach" },
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
    { id: "carol", name: "Carol" },
  ],
  facts: [
    // reports-to: Alice [2024-01-01 .. 2024-06-01), then Bob [2024-06-01 .. open)
    { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: false, validAt: "2024-01-01", invalidAt: "2024-06-01" },
    { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: true, validAt: "2024-06-01", invalidAt: null },
    // knows Carol: no valid_at → not placeable on the timeline
    { id: "f3", subjectId: "zach", predicate: "knows", objectId: "carol", current: true, validAt: null, invalidAt: null },
  ],
};

const at = (d: string) => snapshotAsOf(snapshot, Date.parse(d));

describe("snapshotAsOf", () => {
  it("shows who was Current at a past instant (Alice), marked Current", () => {
    const s = at("2024-03-01");
    expect(s.facts.map((f) => f.id)).toEqual(["f1"]);
    expect(s.facts[0]?.current).toBe(true);
  });

  it("shows the later truth (Bob) after the change", () => {
    expect(at("2024-09-01").facts.map((f) => f.id)).toEqual(["f2"]);
  });

  it("treats interval ends as exclusive: at the switchover instant the new Fact wins", () => {
    expect(at("2024-06-01").facts.map((f) => f.id)).toEqual(["f2"]);
  });

  it("returns nothing before anything was valid", () => {
    expect(at("2023-01-01").facts).toEqual([]);
  });

  it("omits Facts with no valid_at (can't be placed on the timeline)", () => {
    // Carol's 'knows' Fact never appears, even far in the future.
    expect(at("2030-01-01").facts.some((f) => f.id === "f3")).toBe(false);
  });

  it("passes Entities through unchanged", () => {
    expect(at("2024-03-01").entities).toEqual(snapshot.entities);
  });
});

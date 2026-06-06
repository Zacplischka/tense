import { describe, expect, it } from "vitest";
import { factsForEntity, type Snapshot } from "../viewer/lib/graph-model.js";

/**
 * Pure derivation behind the viewer's click-to-inspect panel: the Facts touching
 * one Entity, with direction/counterpart/interval/provenance, Current first.
 */
const snapshot: Snapshot = {
  entities: [
    { id: "zach", name: "Zach" },
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob" },
  ],
  facts: [
    { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: false, validAt: "2024-01-01", invalidAt: "2024-06-01", subject: "Zach", object: "Alice", reinforcedBy: 1 },
    { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: true, validAt: "2024-06-01", invalidAt: null, subject: "Zach", object: "Bob", reinforcedBy: 2 },
    { id: "f3", subjectId: "alice", predicate: "knows", objectId: "zach", current: true, validAt: null, invalidAt: null, subject: "Alice", object: "Zach", reinforcedBy: 1 },
  ],
};

describe("factsForEntity", () => {
  it("returns every Fact touching the Entity, Current first then by predicate", () => {
    const z = factsForEntity(snapshot, "zach");
    // f3 (knows, current), f2 (reports-to, current), then f1 (reports-to, superseded).
    expect(z.map((r) => r.id)).toEqual(["f3", "f2", "f1"]);
  });

  it("labels direction relative to the Entity and names the counterpart", () => {
    const z = factsForEntity(snapshot, "zach");
    expect(z.find((r) => r.id === "f2")).toMatchObject({ direction: "out", other: "Bob", reinforcedBy: 2 });
    expect(z.find((r) => r.id === "f3")).toMatchObject({ direction: "in", other: "Alice", current: true });
    expect(z.find((r) => r.id === "f1")).toMatchObject({ direction: "out", other: "Alice", current: false });
  });

  it("works from the object side and carries the interval", () => {
    const a = factsForEntity(snapshot, "alice");
    expect(a.map((r) => r.id)).toEqual(["f3", "f1"]); // current knows-out first, then superseded in
    expect(a.find((r) => r.id === "f1")).toMatchObject({
      direction: "in",
      other: "Zach",
      validAt: "2024-01-01",
      invalidAt: "2024-06-01",
    });
  });

  it("returns [] for an unknown Entity", () => {
    expect(factsForEntity(snapshot, "nobody")).toEqual([]);
  });

  it("falls back to the entity-name map when subject/object names are absent", () => {
    const bare: Snapshot = {
      entities: [{ id: "x", name: "Ecks" }, { id: "y", name: "Why" }],
      facts: [{ id: "k", subjectId: "x", predicate: "knows", objectId: "y", current: true, validAt: null, invalidAt: null }],
    };
    expect(factsForEntity(bare, "x")[0]).toMatchObject({ other: "Why", reinforcedBy: 0 });
  });
});

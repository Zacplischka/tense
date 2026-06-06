import { describe, expect, it } from "vitest";
import { toGraphModel, type Snapshot } from "../viewer/lib/graph-model.js";

const entities = [
  { id: "zach", name: "Zach" },
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];

describe("toGraphModel", () => {
  it("marks Current Facts solid and superseded Facts dashed (from the current flag)", () => {
    const snapshot: Snapshot = {
      entities,
      facts: [
        { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: false, validAt: "2024-01-01", invalidAt: "2024-06-01" },
        { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: true, validAt: "2024-06-01", invalidAt: null },
      ],
    };
    const model = toGraphModel(snapshot);
    expect(model.edges.find((e) => e.id === "f1")?.current).toBe(false);
    expect(model.edges.find((e) => e.id === "f2")?.current).toBe(true);
  });

  it("uses expired_at (the current flag), NOT invalid_at, to decide Current", () => {
    // Adversarial fixture where valid time and transaction time disagree:
    //   f1: invalid_at SET (valid time says "not true now") but current=true
    //       (expired_at IS NULL) -> must render SOLID.
    //   f2: invalid_at NULL (valid time says "still true") but current=false
    //       (superseded) -> must render DASHED.
    const snapshot: Snapshot = {
      entities,
      facts: [
        { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: true, validAt: "2024-01-01", invalidAt: "2024-06-01" },
        { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: false, validAt: "2024-06-01", invalidAt: null },
      ],
    };
    const model = toGraphModel(snapshot);
    expect(model.edges.find((e) => e.id === "f1")?.current).toBe(true); // follows expired_at
    expect(model.edges.find((e) => e.id === "f2")?.current).toBe(false);
  });

  it("lays out nodes deterministically (stable positions across renders)", () => {
    const snapshot: Snapshot = { entities, facts: [] };
    const a = toGraphModel(snapshot);
    const b = toGraphModel(snapshot);
    expect(a.nodes).toEqual(b.nodes);
    // Sorted by name: Alice, Bob, Zach.
    expect(a.nodes.map((n) => n.name)).toEqual(["Alice", "Bob", "Zach"]);
  });

  it("drops edges whose endpoints are missing (orphan guard)", () => {
    const snapshot: Snapshot = {
      entities: [{ id: "zach", name: "Zach" }],
      facts: [
        { id: "f1", subjectId: "zach", predicate: "knows", objectId: "ghost", current: true, validAt: null, invalidAt: null },
      ],
    };
    expect(toGraphModel(snapshot).edges).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { toGraphData, type Snapshot } from "../viewer/lib/graph-model.js";

const entities = [
  { id: "zach", name: "Zach" },
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
];

describe("toGraphData", () => {
  it("marks Current Facts and superseded Facts from the current flag", () => {
    const snapshot: Snapshot = {
      entities,
      facts: [
        { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: false, validAt: "2024-01-01", invalidAt: "2024-06-01" },
        { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: true, validAt: "2024-06-01", invalidAt: null },
      ],
    };
    const { links } = toGraphData(snapshot);
    expect(links.find((l) => l.id === "f1")?.current).toBe(false);
    expect(links.find((l) => l.id === "f2")?.current).toBe(true);
  });

  it("uses the current flag (expired_at), NOT invalid_at, to decide Current", () => {
    // Adversarial: valid time and transaction time disagree.
    const snapshot: Snapshot = {
      entities,
      facts: [
        { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: true, validAt: "2024-01-01", invalidAt: "2024-06-01" },
        { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: false, validAt: "2024-06-01", invalidAt: null },
      ],
    };
    const { links } = toGraphData(snapshot);
    expect(links.find((l) => l.id === "f1")?.current).toBe(true); // follows the flag
    expect(links.find((l) => l.id === "f2")?.current).toBe(false);
  });

  it("maps every Entity to a node and carries the predicate on each link", () => {
    const snapshot: Snapshot = {
      entities,
      facts: [
        { id: "f1", subjectId: "zach", predicate: "knows", objectId: "alice", current: true, validAt: null, invalidAt: null },
      ],
    };
    const { nodes, links } = toGraphData(snapshot);
    expect(nodes.map((n) => n.id).sort()).toEqual(["alice", "bob", "zach"]);
    expect(links[0]).toMatchObject({ source: "zach", target: "alice", predicate: "knows" });
  });

  it("drops Facts whose endpoints are missing (orphan guard)", () => {
    const snapshot: Snapshot = {
      entities: [{ id: "zach", name: "Zach" }],
      facts: [
        { id: "f1", subjectId: "zach", predicate: "knows", objectId: "ghost", current: true, validAt: null, invalidAt: null },
      ],
    };
    expect(toGraphData(snapshot).links).toHaveLength(0);
  });
});

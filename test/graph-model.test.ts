import { describe, expect, it } from "vitest";
import { factLinkWidth, factsForEntity, toGraphData, type Snapshot } from "../viewer/lib/graph-model.js";

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

describe("factLinkWidth", () => {
  it("keeps superseded edges thin regardless of source count", () => {
    expect(factLinkWidth(false, 1)).toBe(0.8);
    expect(factLinkWidth(false, 9)).toBe(0.8);
  });

  it("grows a Current edge gently with each reinforcing Source", () => {
    expect(factLinkWidth(true, 1)).toBe(1.4);
    expect(factLinkWidth(true, 2)).toBeCloseTo(2.0);
    expect(factLinkWidth(true, 3)).toBeCloseTo(2.6);
  });

  it("caps width so a heavily-cited edge can't blow out the layout", () => {
    expect(factLinkWidth(true, 5)).toBeCloseTo(3.8);
    expect(factLinkWidth(true, 100)).toBeCloseTo(3.8);
  });

  it("treats a degenerate 0/<1 count as the base width", () => {
    expect(factLinkWidth(true, 0)).toBe(1.4);
  });
});

describe("factsForEntity", () => {
  const snapshot: Snapshot = {
    entities,
    facts: [
      { id: "f1", subjectId: "zach", predicate: "reports-to", objectId: "alice", current: false, validAt: "2024-01-01", invalidAt: "2024-06-01", reinforcedBy: 1, learnedAt: "2025-09-12T18:04:51.880Z" },
      { id: "f2", subjectId: "zach", predicate: "reports-to", objectId: "bob", current: true, validAt: "2024-06-01", invalidAt: null, reinforcedBy: 2, learnedAt: "2025-09-12T18:04:53.217Z" },
    ],
  };

  it("carries learnedAt (transaction time) through to the detail panel rows", () => {
    const rows = factsForEntity(snapshot, "zach");
    expect(rows.map((r) => r.learnedAt)).toEqual([
      "2025-09-12T18:04:53.217Z", // f2 (Current) sorts first
      "2025-09-12T18:04:51.880Z", // f1 (superseded)
    ]);
  });

  it("defaults learnedAt to null when the snapshot omits it", () => {
    const noTx: Snapshot = {
      entities,
      facts: [{ id: "f1", subjectId: "zach", predicate: "knows", objectId: "alice", current: true, validAt: null, invalidAt: null }],
    };
    expect(factsForEntity(noTx, "zach")[0]?.learnedAt).toBeNull();
  });

  it("exposes the counterpart Entity id so the panel can navigate to it", () => {
    const rows = factsForEntity(snapshot, "zach");
    // Both Facts have Zach as subject, so the counterpart is the object.
    expect(rows.map((r) => r.otherId)).toEqual(["bob", "alice"]); // Current (Bob) first
    // direction "in" picks the subject as the counterpart.
    const inbound = factsForEntity(snapshot, "alice");
    expect(inbound[0]).toMatchObject({ direction: "in", otherId: "zach", other: "Zach" });
  });

  it("orders Current Facts before superseded ones", () => {
    const rows = factsForEntity(snapshot, "zach");
    expect(rows.map((r) => r.current)).toEqual([true, false]);
  });
});

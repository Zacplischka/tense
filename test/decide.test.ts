import { describe, expect, it } from "vitest";
import { decideFact } from "../src/supersession/decide.js";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import type { Fact } from "../src/domain/types.js";

/**
 * The per-Fact decision shared by remember (writes) and preview (read-only).
 * Pure — no DB. Reaffirm vs write-with-supersession, wrapping resolveSupersession.
 */
const registry = defaultPredicateRegistry(); // reports-to: single, knows: multi
const now = new Date("2026-01-01T00:00:00Z");

function fact(over: { id: string; objectId: string; predicate?: string; validAt?: Date | null }): Fact {
  return {
    id: over.id,
    subjectId: "zach",
    predicate: over.predicate ?? "reports-to",
    objectId: over.objectId,
    sourceId: "src",
    validAt: over.validAt ?? null,
    invalidAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    expiredAt: null,
  };
}

describe("decideFact", () => {
  it("reaffirms when the exact Fact (same object) is already Current", () => {
    const current = [fact({ id: "f1", objectId: "bob" })];
    const d = decideFact({ currentFacts: current, objectId: "bob", predicate: "reports-to", validAt: null, registry, now });
    expect(d).toEqual({ kind: "reaffirm", factId: "f1" });
  });

  it("writes without superseding on a multi-valued Predicate (knows)", () => {
    const current = [fact({ id: "k1", objectId: "ann", predicate: "knows" })];
    const d = decideFact({ currentFacts: current, objectId: "ben", predicate: "knows", validAt: null, registry, now });
    expect(d.kind).toBe("write");
    if (d.kind === "write") {
      expect(d.plan.direction).toBe("no-supersession");
      expect(d.plan.toClose).toEqual([]);
    }
  });

  it("supersedes the prior value on a single-valued Predicate (reports-to)", () => {
    const current = [fact({ id: "r1", objectId: "alice", validAt: new Date("2024-01-01T00:00:00Z") })];
    const d = decideFact({
      currentFacts: current,
      objectId: "bob",
      predicate: "reports-to",
      validAt: new Date("2024-06-01T00:00:00Z"),
      registry,
      now,
    });
    expect(d.kind).toBe("write");
    if (d.kind === "write") {
      expect(d.plan.direction).toBe("new-supersedes-existing");
      expect(d.plan.toClose.map((c) => c.factId)).toEqual(["r1"]);
    }
  });

  it("a would-be-new object (objectId null) never reaffirms", () => {
    const current = [fact({ id: "k1", objectId: "ann", predicate: "knows" })];
    const d = decideFact({ currentFacts: current, objectId: null, predicate: "knows", validAt: null, registry, now });
    expect(d.kind).toBe("write");
  });
});

import { describe, expect, it } from "vitest";
import { defaultPredicateRegistry } from "../src/supersession/registry.js";
import { resolveSupersession } from "../src/supersession/resolver.js";

const registry = defaultPredicateRegistry();
const NOW = new Date("2026-01-01T00:00:00Z");

const d = (iso: string) => new Date(iso);

describe("resolveSupersession", () => {
  it("with no candidates: no supersession, new Fact born Current", () => {
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: d("2024-01-01T00:00:00Z") },
      candidateFacts: [],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("no-supersession");
    expect(plan.toClose).toEqual([]);
    expect(plan.newFact).toEqual({
      validAt: d("2024-01-01T00:00:00Z"),
      invalidAt: null,
      expiredAt: null,
    });
  });

  it("never supersedes on a multi-valued Predicate, even with a candidate", () => {
    const plan = resolveSupersession({
      newFact: { predicate: "knows", validAt: d("2024-06-01T00:00:00Z") },
      candidateFacts: [{ id: "alice", validAt: d("2024-01-01T00:00:00Z"), createdAt: d("2024-01-02T00:00:00Z") }],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("no-supersession");
    expect(plan.toClose).toEqual([]);
    expect(plan.newFact.expiredAt).toBeNull(); // born Current
  });

  it("single-valued, newer valid_at: new closes existing with correct intervals", () => {
    const existing = { id: "alice", validAt: d("2024-01-01T00:00:00Z"), createdAt: d("2024-01-02T00:00:00Z") };
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: d("2024-06-01T00:00:00Z") },
      candidateFacts: [existing],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("new-supersedes-existing");
    // Existing Fact closed: valid-time end = new valid_at; transaction-time end = now.
    expect(plan.toClose).toEqual([
      { factId: "alice", invalidAt: d("2024-06-01T00:00:00Z"), expiredAt: NOW },
    ]);
    // New Fact born Current.
    expect(plan.newFact).toEqual({
      validAt: d("2024-06-01T00:00:00Z"),
      invalidAt: null,
      expiredAt: null,
    });
  });

  it("single-valued, older valid_at (out-of-order): new Fact born already-expired, nothing closed", () => {
    const existing = { id: "bob", validAt: d("2024-06-01T00:00:00Z"), createdAt: d("2024-06-02T00:00:00Z") };
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: d("2024-01-01T00:00:00Z") },
      candidateFacts: [existing],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("existing-supersedes-new");
    expect(plan.toClose).toEqual([]); // the existing newer Fact stays Current
    // The new (older) Fact is born expired; its valid interval ends when the
    // newer truth began.
    expect(plan.newFact).toEqual({
      validAt: d("2024-01-01T00:00:00Z"),
      invalidAt: d("2024-06-01T00:00:00Z"),
      expiredAt: NOW,
    });
  });

  it("single-valued, tied valid_at: transaction-time tiebreak makes the incoming Fact win", () => {
    const sameValidAt = d("2024-03-01T00:00:00Z");
    const existing = { id: "alice", validAt: sameValidAt, createdAt: d("2024-03-02T00:00:00Z") };
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: sameValidAt },
      candidateFacts: [existing],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("new-supersedes-existing");
    expect(plan.toClose).toEqual([{ factId: "alice", invalidAt: sameValidAt, expiredAt: NOW }]);
    expect(plan.newFact.expiredAt).toBeNull(); // born Current
  });

  it("single-valued, null valid_at on the incoming Fact: transaction-time fallback, invalid_at = now", () => {
    const existing = { id: "alice", validAt: d("2024-01-01T00:00:00Z"), createdAt: d("2024-01-02T00:00:00Z") };
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: null }, // "Zach now reports to Bob"
      candidateFacts: [existing],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("new-supersedes-existing");
    // No valid_at to close on -> transaction time stands in, explicitly.
    expect(plan.toClose).toEqual([{ factId: "alice", invalidAt: NOW, expiredAt: NOW }]);
    expect(plan.newFact).toEqual({ validAt: null, invalidAt: null, expiredAt: null });
  });

  it("single-valued, null valid_at on the existing Fact: incoming Fact still wins (can't prove existing is newer)", () => {
    const existing = { id: "alice", validAt: null, createdAt: d("2024-01-02T00:00:00Z") };
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: d("2024-06-01T00:00:00Z") },
      candidateFacts: [existing],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("new-supersedes-existing");
    expect(plan.toClose).toEqual([
      { factId: "alice", invalidAt: d("2024-06-01T00:00:00Z"), expiredAt: NOW },
    ]);
  });

  it("an unknown Predicate (defaults to multi) never closes history, even with a newer valid_at", () => {
    const existing = { id: "old", validAt: d("2024-01-01T00:00:00Z"), createdAt: d("2024-01-02T00:00:00Z") };
    const plan = resolveSupersession({
      newFact: { predicate: "invented-by", validAt: d("2024-06-01T00:00:00Z") },
      candidateFacts: [existing],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("no-supersession");
    expect(plan.toClose).toEqual([]);
    expect(plan.newFact.expiredAt).toBeNull();
  });
});

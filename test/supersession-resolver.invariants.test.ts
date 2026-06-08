import { describe, expect, it } from "vitest";
import { PredicateRegistry } from "../src/supersession/registry.js";
import {
  existingIsNewer,
  resolveSupersession,
  type CandidateFact,
  type ResolverInput,
} from "../src/supersession/resolver.js";

/**
 * Invariant / fuzz suite for the pure supersession resolver.
 *
 * The example-based suite (`supersession-resolver.test.ts`) pins specific
 * single-candidate outcomes. This suite instead asserts the *spec* — the
 * properties that must hold for ANY input — over thousands of randomly generated
 * scenarios, including the **multi-candidate** path the examples never reach (a
 * subject carrying several Current Facts on one Predicate, e.g. after concurrent
 * out-of-order ingestion). A seeded PRNG keeps it deterministic and dependency-free,
 * so a violation reproduces byte-for-byte from the printed seed.
 */

// Deterministic PRNG (mulberry32) — no Math.random, so every run is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const registry = new PredicateRegistry({
  "reports-to": "single",
  "lives-in": "single",
  "knows": "multi",
  "contributed-to": "multi",
});
const PREDICATES = ["reports-to", "lives-in", "knows", "contributed-to", "invented-by"]; // last is unknown -> multi
const NOW = new Date("2030-01-01T00:00:00Z");
const EPOCH = Date.parse("2020-01-01T00:00:00Z");
const DAY = 86_400_000;

/** A small palette of valid_at values, biased to produce ties and nulls. */
function pickValidAt(rng: () => number): Date | null {
  if (rng() < 0.2) return null; // ~20% unknown valid time
  // 0..120 distinct days, so collisions (ties) are common.
  return new Date(EPOCH + Math.floor(rng() * 120) * DAY);
}

function makeScenario(rng: () => number): ResolverInput {
  const predicate = PREDICATES[Math.floor(rng() * PREDICATES.length)]!;
  const n = Math.floor(rng() * 5); // 0..4 candidates
  const candidateFacts: CandidateFact[] = Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    validAt: pickValidAt(rng),
    createdAt: new Date(EPOCH + Math.floor(rng() * 120) * DAY),
  }));
  return {
    newFact: { predicate, validAt: pickValidAt(rng) },
    candidateFacts,
    registry,
    now: NOW,
  };
}

/** Structural snapshot for the purity check (Dates -> epoch numbers). */
function snapshot(input: ResolverInput): string {
  return JSON.stringify(input, (_k, v) => (v instanceof Date ? v.getTime() : v));
}

describe("resolveSupersession — invariants over random scenarios", () => {
  it("holds every invariant across 5000 seeded scenarios", () => {
    const rng = mulberry32(0xc0ffee);

    for (let iter = 0; iter < 5000; iter++) {
      const input = makeScenario(rng);
      const before = snapshot(input);
      const plan = resolveSupersession(input);
      const { newFact, candidateFacts } = input;
      const single = registry.cardinalityOf(newFact.predicate) === "single";
      // Context the assertion messages can point back to a single failing seed.
      const ctx = `iter=${iter} input=${before}`;

      // --- Purity: the resolver mutates none of its inputs. -------------------
      expect(snapshot(input), `mutated inputs · ${ctx}`).toBe(before);

      // --- Determinism: identical input -> deep-equal plan. -------------------
      expect(resolveSupersession(input), `non-deterministic · ${ctx}`).toEqual(plan);

      // --- The incoming Fact's start is never invented. -----------------------
      expect(plan.newFact.validAt, `validAt drift · ${ctx}`).toEqual(newFact.validAt);

      // --- Direction <-> shape consistency. -----------------------------------
      switch (plan.direction) {
        case "no-supersession":
          expect(plan.toClose, `no-supersession closed something · ${ctx}`).toEqual([]);
          expect(plan.newFact.expiredAt, `no-supersession not born Current · ${ctx}`).toBeNull();
          expect(plan.newFact.invalidAt, `no-supersession new Fact pre-closed · ${ctx}`).toBeNull();
          break;
        case "new-supersedes-existing":
          // Born Current...
          expect(plan.newFact.expiredAt, `new-supersedes not born Current · ${ctx}`).toBeNull();
          expect(plan.newFact.invalidAt, `new-supersedes new Fact pre-closed · ${ctx}`).toBeNull();
          // ...and it must actually close at least one prior Fact.
          expect(plan.toClose.length, `new-supersedes closed nothing · ${ctx}`).toBeGreaterThan(0);
          break;
        case "existing-supersedes-new":
          // Out-of-order: nothing closes, the incoming Fact is born already-expired.
          expect(plan.toClose, `existing-supersedes closed something · ${ctx}`).toEqual([]);
          expect(plan.newFact.expiredAt, `existing-supersedes not born expired · ${ctx}`).toEqual(NOW);
          expect(plan.newFact.invalidAt, `existing-supersedes left interval open · ${ctx}`).not.toBeNull();
          break;
      }

      // --- Cardinality is the gate: multi/unknown never supersedes. -----------
      if (!single) {
        expect(plan.direction, `multi-valued superseded · ${ctx}`).toBe("no-supersession");
      }

      // --- Single-valued with no candidates: nothing to supersede. ------------
      if (single && candidateFacts.length === 0) {
        expect(plan.direction, `empty candidates superseded · ${ctx}`).toBe("no-supersession");
      }

      // --- Out-of-order branch fires iff some existing is provably newer. -----
      if (single && candidateFacts.length > 0) {
        const someNewer = candidateFacts.some((c) => existingIsNewer(c, newFact.validAt));
        expect(plan.direction === "existing-supersedes-new", `out-of-order branch mismatch · ${ctx}`).toBe(
          someNewer,
        );
      }

      // --- When the incoming Fact wins, it closes EVERY Current Fact (the
      //     multi-candidate completeness property the examples never exercise).
      if (plan.direction === "new-supersedes-existing") {
        expect(plan.toClose.length, `did not close all candidates · ${ctx}`).toBe(candidateFacts.length);
        const closedIds = plan.toClose.map((c) => c.factId);
        expect(new Set(closedIds).size, `duplicate close · ${ctx}`).toBe(closedIds.length);
        expect(new Set(closedIds), `closed an unknown id · ${ctx}`).toEqual(
          new Set(candidateFacts.map((c) => c.id)),
        );
      }

      // --- Close-plan integrity: every close ends at `now`, with a non-negative
      //     valid interval (a closed Fact never ends before it began).
      const byId = new Map(candidateFacts.map((c) => [c.id, c]));
      for (const close of plan.toClose) {
        expect(close.expiredAt, `expiredAt != now · ${ctx}`).toEqual(NOW);
        // invalid_at is the incoming valid_at when known, else the `now` fallback.
        expect(close.invalidAt, `unexpected invalidAt · ${ctx}`).toEqual(newFact.validAt ?? NOW);
        const closed = byId.get(close.factId)!;
        if (closed.validAt !== null && close.invalidAt !== null) {
          expect(
            close.invalidAt.getTime() >= closed.validAt.getTime(),
            `negative-length interval · ${ctx}`,
          ).toBe(true);
        }
      }
    }
  });

  it("multi-candidate: a newer single-valued Fact closes ALL prior Current Facts at once", () => {
    // Two Current Facts on one (subject, predicate) — the state the examples skip.
    const plan = resolveSupersession({
      newFact: { predicate: "reports-to", validAt: new Date("2024-09-01T00:00:00Z") },
      candidateFacts: [
        { id: "alice", validAt: new Date("2024-01-01T00:00:00Z"), createdAt: new Date("2024-01-02T00:00:00Z") },
        { id: "bob", validAt: new Date("2024-06-01T00:00:00Z"), createdAt: new Date("2024-06-02T00:00:00Z") },
      ],
      registry,
      now: NOW,
    });

    expect(plan.direction).toBe("new-supersedes-existing");
    expect(plan.toClose.map((c) => c.factId).sort()).toEqual(["alice", "bob"]);
    for (const close of plan.toClose) {
      expect(close.invalidAt).toEqual(new Date("2024-09-01T00:00:00Z"));
      expect(close.expiredAt).toEqual(NOW);
    }
  });
});

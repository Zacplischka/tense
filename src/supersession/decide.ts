import type { Fact } from "../domain/types.js";
import type { PredicateRegistry } from "./registry.js";
import { resolveSupersession, type SupersessionPlan } from "./resolver.js";
import { toCandidateFact } from "./apply.js";

/**
 * The per-Fact decision shared by `remember` (which writes) and `preview` (which
 * doesn't): an incoming Fact is either a **Reaffirmation** of an already-Current
 * identical Fact (ADR 0005 — same subject→predicate→object), or a **write** whose
 * {@link SupersessionPlan} says which prior Facts it closes (cardinality, ADR 0002).
 *
 * Both callers feed it the SAME inputs and act on the SAME result, so preview
 * predicts remember by construction rather than by parallel code that can drift.
 * It is pure (no I/O); the caller supplies the current Facts and applies the plan.
 */
export type FactDecision =
  | { kind: "reaffirm"; factId: string }
  | { kind: "write"; plan: SupersessionPlan };

export function decideFact(input: {
  /** The Current Facts for the incoming Fact's (subject, predicate). */
  currentFacts: Fact[];
  /** Resolved object Entity id, or null when the object would be newly created. */
  objectId: string | null;
  predicate: string;
  validAt: Date | null;
  registry: PredicateRegistry;
  now: Date;
}): FactDecision {
  const { currentFacts, objectId, predicate, validAt, registry, now } = input;

  // Reaffirmation: this exact Fact (same object) is already Current. A would-be-new
  // object (objectId null) can never match an existing Current Fact.
  const existing = objectId !== null ? currentFacts.find((c) => c.objectId === objectId) : undefined;
  if (existing) return { kind: "reaffirm", factId: existing.id };

  const plan = resolveSupersession({
    newFact: { predicate, validAt },
    candidateFacts: currentFacts.map(toCandidateFact),
    registry,
    now,
  });
  return { kind: "write", plan };
}

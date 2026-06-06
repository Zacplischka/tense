import type { Fact } from "../domain/types.js";
import type { FactClose, NewFact, TemporalGraphStore } from "../db/store.js";
import type { CandidateFact, SupersessionPlan } from "./resolver.js";

/** The incoming Fact's identity — supplied by the caller, orthogonal to timing. */
export interface NewFactIdentity {
  subjectId: string;
  predicate: string;
  objectId: string;
  sourceId: string;
}

/** Project a stored Fact down to what the pure resolver needs. */
export function toCandidateFact(fact: Fact): CandidateFact {
  return { id: fact.id, validAt: fact.validAt, createdAt: fact.createdAt };
}

/**
 * Apply a resolved {@link SupersessionPlan} through the store's atomic boundary:
 * close the planned Facts and insert the incoming one in a single transaction.
 * This is the only coupling between the pure resolver and persistence.
 */
export async function applySupersessionPlan(
  store: TemporalGraphStore,
  plan: SupersessionPlan,
  identity: NewFactIdentity,
): Promise<{ closed: Fact[]; inserted: Fact }> {
  const closes: FactClose[] = plan.toClose.map((c) => ({
    factId: c.factId,
    invalidAt: c.invalidAt,
    expiredAt: c.expiredAt,
  }));

  const newFact: NewFact = {
    subjectId: identity.subjectId,
    predicate: identity.predicate,
    objectId: identity.objectId,
    sourceId: identity.sourceId,
    validAt: plan.newFact.validAt,
    invalidAt: plan.newFact.invalidAt,
    expiredAt: plan.newFact.expiredAt,
  };

  return store.supersedeAndInsert(closes, newFact);
}

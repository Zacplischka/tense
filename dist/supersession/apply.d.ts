import type { Fact } from "../domain/types.js";
import type { TemporalGraphStore } from "../db/store.js";
import type { CandidateFact, SupersessionPlan } from "./resolver.js";
/** The incoming Fact's identity — supplied by the caller, orthogonal to timing. */
export interface NewFactIdentity {
    subjectId: string;
    predicate: string;
    objectId: string;
    sourceId: string;
}
/** Project a stored Fact down to what the pure resolver needs. */
export declare function toCandidateFact(fact: Fact): CandidateFact;
/**
 * Apply a resolved {@link SupersessionPlan} through the store's atomic boundary:
 * close the planned Facts and insert the incoming one in a single transaction.
 * This is the only coupling between the pure resolver and persistence.
 */
export declare function applySupersessionPlan(store: TemporalGraphStore, plan: SupersessionPlan, identity: NewFactIdentity): Promise<{
    closed: Fact[];
    inserted: Fact;
}>;

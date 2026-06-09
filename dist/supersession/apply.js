/** Project a stored Fact down to what the pure resolver needs. */
export function toCandidateFact(fact) {
    return { id: fact.id, validAt: fact.validAt, createdAt: fact.createdAt };
}
/**
 * Apply a resolved {@link SupersessionPlan} through the store's atomic boundary:
 * close the planned Facts and insert the incoming one in a single transaction.
 * This is the only coupling between the pure resolver and persistence.
 */
export async function applySupersessionPlan(store, plan, identity) {
    const closes = plan.toClose.map((c) => ({
        factId: c.factId,
        invalidAt: c.invalidAt,
        expiredAt: c.expiredAt,
    }));
    const newFact = {
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
//# sourceMappingURL=apply.js.map
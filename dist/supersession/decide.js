import { resolveSupersession } from "./resolver.js";
import { toCandidateFact } from "./apply.js";
export function decideFact(input) {
    const { currentFacts, objectId, predicate, validAt, registry, now } = input;
    // Reaffirmation: this exact Fact (same object) is already Current. A would-be-new
    // object (objectId null) can never match an existing Current Fact.
    const existing = objectId !== null ? currentFacts.find((c) => c.objectId === objectId) : undefined;
    if (existing)
        return { kind: "reaffirm", factId: existing.id };
    const plan = resolveSupersession({
        newFact: { predicate, validAt },
        candidateFacts: currentFacts.map(toCandidateFact),
        registry,
        now,
    });
    return { kind: "write", plan };
}
//# sourceMappingURL=decide.js.map
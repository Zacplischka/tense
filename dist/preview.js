import { decideFact } from "./supersession/decide.js";
export async function previewRemember(deps, text) {
    const { store, extractor, resolver, registry } = deps;
    const now = deps.now ?? (() => new Date());
    const knownEntities = await store.listEntityNames();
    const extracted = await extractor.extract(text, knownEntities);
    const preview = {
        factsToCreate: [],
        factsToSupersede: [],
        factsToReaffirm: [],
        entitiesResolved: [],
    };
    const resolutions = new Map();
    // Read-only resolution: resolver.resolve() and store reads never write. A name
    // with no match resolves to id=null ("would be created").
    const resolveReadOnly = async (name) => {
        const result = await resolver.resolve(name);
        let resolvedName = name;
        let id = null;
        let reason = "new";
        if (result.entityId) {
            const existing = await store.getEntity(result.entityId);
            if (existing) {
                resolvedName = existing.name;
                id = existing.id;
                reason = result.reason === "exact" ? "exact" : "fuzzy";
            }
        }
        if (!resolutions.has(name)) {
            resolutions.set(name, {
                input: name,
                resolvedTo: resolvedName,
                reason,
                ...(reason === "fuzzy" && result.matched ? { similarity: result.matched.similarity } : {}),
            });
        }
        return { name: resolvedName, id };
    };
    for (const fact of extracted.facts) {
        const subject = await resolveReadOnly(fact.subject);
        const object = await resolveReadOnly(fact.object);
        // A brand-new subject has no current Facts to supersede or reaffirm.
        const currentFacts = subject.id ? await store.currentFactsFor(subject.id, fact.predicate) : [];
        // SAME decision remember makes — so this preview predicts it (ADR 0002/0005).
        const decision = decideFact({
            currentFacts,
            objectId: object.id,
            predicate: fact.predicate,
            validAt: fact.validAt,
            registry,
            now: now(),
        });
        if (decision.kind === "reaffirm") {
            preview.factsToReaffirm.push({ subject: subject.name, predicate: fact.predicate, object: object.name });
            continue;
        }
        preview.factsToCreate.push({ subject: subject.name, predicate: fact.predicate, object: object.name });
        for (const close of decision.plan.toClose) {
            const closed = currentFacts.find((f) => f.id === close.factId);
            const closedObject = closed ? await store.getEntity(closed.objectId) : null;
            preview.factsToSupersede.push({
                subject: subject.name,
                predicate: fact.predicate,
                object: closedObject?.name ?? closed?.objectId ?? "",
            });
        }
    }
    preview.entitiesResolved = [...resolutions.values()];
    return preview;
}
//# sourceMappingURL=preview.js.map
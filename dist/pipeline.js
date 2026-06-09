import { applySupersessionPlan } from "./supersession/apply.js";
import { decideFact } from "./supersession/decide.js";
import { resolveContradictions } from "./contradiction/contradiction.js";
export async function remember(deps, text, sourceLabel = null) {
    const { store, extractor, resolver, registry, provider } = deps;
    const clock = deps.now ?? (() => new Date());
    // Extract BEFORE any write, so a bad-output failure leaves the graph untouched
    // (no orphan Source). Throws ExtractionError on malformed LLM output.
    const knownEntities = await store.listEntityNames();
    const extracted = await extractor.extract(text, knownEntities);
    const source = await store.insertSource(text, sourceLabel);
    const summary = {
        sourceId: source.id,
        factsCreated: [],
        factsSuperseded: [],
        factsReaffirmed: [],
        entitiesResolved: [],
    };
    // Resolve each name to an Entity, recording how it resolved (first occurrence of
    // a given input name wins — the decision made against the pre-existing graph).
    const resolutions = new Map();
    const resolveAndRecord = async (name) => {
        const result = await resolver.resolve(name);
        let entity;
        let reason;
        if (result.entityId) {
            const matched = await store.getEntity(result.entityId);
            if (matched) {
                entity = matched;
                reason = result.reason === "exact" ? "exact" : "fuzzy";
            }
            else {
                entity = await store.upsertEntity(name); // matched row vanished — treat as new
                reason = "new";
            }
        }
        else {
            entity = await store.upsertEntity(name);
            reason = "new";
        }
        if (!resolutions.has(name)) {
            resolutions.set(name, {
                input: name,
                resolvedTo: entity.name,
                reason,
                ...(reason === "fuzzy" && result.matched ? { similarity: result.matched.similarity } : {}),
            });
        }
        return entity;
    };
    for (const fact of extracted.facts) {
        const subject = await resolveAndRecord(fact.subject);
        const object = await resolveAndRecord(fact.object);
        const currentFacts = await store.currentFactsFor(subject.id, fact.predicate);
        // The per-Fact decision (reaffirm vs write-with-supersessions) is shared with
        // `preview` via decideFact, so a dry-run predicts this exact outcome.
        const decision = decideFact({
            currentFacts,
            objectId: object.id,
            predicate: fact.predicate,
            validAt: fact.validAt,
            registry,
            now: clock(),
        });
        // Reaffirmation (ADR 0005): this exact Fact is already Current — don't create a
        // duplicate or supersede anything; just record this Source as added provenance.
        if (decision.kind === "reaffirm") {
            await store.addFactSource(decision.factId, source.id);
            summary.factsReaffirmed.push({
                id: decision.factId,
                subject: subject.name,
                predicate: fact.predicate,
                object: object.name,
            });
            continue;
        }
        const { closed, inserted } = await applySupersessionPlan(store, decision.plan, {
            subjectId: subject.id,
            predicate: fact.predicate,
            objectId: object.id,
            sourceId: source.id,
        });
        // Record the origin Source in the provenance join too, so "reinforced N
        // times" counts consistently for Facts created after this migration.
        await store.addFactSource(inserted.id, source.id);
        summary.factsCreated.push({
            id: inserted.id,
            subject: subject.name,
            predicate: fact.predicate,
            object: object.name,
        });
        for (const c of closed) {
            const closedObject = await store.getEntity(c.objectId);
            summary.factsSuperseded.push({
                id: c.id,
                subject: subject.name,
                predicate: fact.predicate,
                object: closedObject?.name ?? c.objectId,
                reason: "cardinality",
            });
        }
        // Best-effort embedding for hybrid recall — never blocks or fails the write.
        if (provider) {
            try {
                const [embedding] = await provider.embed([`${subject.name} ${fact.predicate} ${object.name}`]);
                if (embedding)
                    await store.setFactEmbedding(inserted.id, embedding);
            }
            catch (err) {
                // Best-effort: the Fact is still stored, recall still works on keyword +
                // temporal filter. But warn (stderr — never stdout/MCP) so a misconfigured
                // or down embedding provider doesn't SILENTLY degrade semantic recall.
                console.error("[tense] embedding failed; Fact stored without a vector (semantic recall degraded):", err instanceof Error ? err.message : err);
            }
        }
        // LLM-judged contradiction (off the critical demo path). Catches cross-
        // Predicate conflicts cardinality can't (works-at vs left). Reuses slice 03's
        // direction rule. Best-effort: a judge failure never breaks ingestion.
        if (deps.enableContradiction && provider && inserted.expiredAt === null) {
            const contradicted = await resolveContradictions({ store, provider, now: clock, model: undefined }, {
                id: inserted.id,
                subjectId: subject.id,
                subject: subject.name,
                predicate: fact.predicate,
                object: object.name,
                validAt: fact.validAt,
            });
            for (const c of contradicted) {
                if (c.id === inserted.id)
                    continue; // the new Fact closed itself (out-of-order)
                const closedObject = await store.getEntity(c.objectId);
                summary.factsSuperseded.push({
                    id: c.id,
                    subject: subject.name,
                    predicate: c.predicate,
                    object: closedObject?.name ?? c.objectId,
                    reason: "contradiction",
                });
            }
        }
    }
    summary.entitiesResolved = [...resolutions.values()];
    return summary;
}
//# sourceMappingURL=pipeline.js.map
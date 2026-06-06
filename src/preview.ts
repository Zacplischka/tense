import type { RememberDeps, EntityResolution } from "./pipeline.js";
import { decideFact } from "./supersession/decide.js";

/**
 * Dry-run of {@link remember}: report what ingesting `text` WOULD do — Facts it
 * would create / supersede / reaffirm, and how each name resolves — WITHOUT
 * writing anything. Lets an agent preview the side effects of a Source (and the
 * supersessions it would trigger) before committing it to memory.
 *
 * It runs the SAME decision the real path runs: extraction, read-only entity
 * resolution, and the pure {@link resolveSupersession} cardinality resolver — so
 * preview and remember agree by construction. The contradiction (LLM) path is not
 * simulated; preview covers the deterministic cardinality path that the default
 * ingest runs on.
 *
 * Limitation: it simulates against the graph's CURRENT state, not intra-batch
 * effects — if one `text` contains several Facts about a brand-new subject that
 * supersede each other, those later supersessions aren't reflected (the subject
 * doesn't exist yet to query). Accurate for the common case: previewing a Source
 * against existing memory.
 */
export interface PreviewFact {
  subject: string;
  predicate: string;
  object: string;
}

export interface RememberPreview {
  /** Facts that would be created (new relationships, including born-historical ones). */
  factsToCreate: PreviewFact[];
  /** Existing Current Facts that would be superseded (closed, never deleted). */
  factsToSupersede: PreviewFact[];
  /** Existing Current Facts that would simply gain this Source as provenance. */
  factsToReaffirm: PreviewFact[];
  /** How each distinct name would resolve (new / exact / fuzzy). */
  entitiesResolved: EntityResolution[];
}

export async function previewRemember(deps: RememberDeps, text: string): Promise<RememberPreview> {
  const { store, extractor, resolver, registry } = deps;
  const now = deps.now ?? (() => new Date());

  const knownEntities = await store.listEntityNames();
  const extracted = await extractor.extract(text, knownEntities);

  const preview: RememberPreview = {
    factsToCreate: [],
    factsToSupersede: [],
    factsToReaffirm: [],
    entitiesResolved: [],
  };
  const resolutions = new Map<string, EntityResolution>();

  // Read-only resolution: resolver.resolve() and store reads never write. A name
  // with no match resolves to id=null ("would be created").
  const resolveReadOnly = async (name: string): Promise<{ name: string; id: string | null }> => {
    const result = await resolver.resolve(name);
    let resolvedName = name;
    let id: string | null = null;
    let reason: EntityResolution["reason"] = "new";
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

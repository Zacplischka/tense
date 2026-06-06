import type { Entity } from "./domain/types.js";
import type { TemporalGraphStore } from "./db/store.js";
import type { Extractor } from "./extraction/types.js";
import type { EntityResolver } from "./resolution/entity-resolver.js";
import type { PredicateRegistry } from "./supersession/registry.js";
import type { ProviderClient } from "./provider/types.js";
import { resolveSupersession } from "./supersession/resolver.js";
import { applySupersessionPlan, toCandidateFact } from "./supersession/apply.js";
import { resolveContradictions } from "./contradiction/contradiction.js";

/**
 * The converged ingest path (slice 07): remember = extract → resolve Entities →
 * supersede (cardinality) → persist atomically, then embed best-effort. The
 * three independently-built modules become one pipeline here.
 */
export interface RememberDeps {
  store: TemporalGraphStore;
  extractor: Extractor;
  resolver: EntityResolver;
  registry: PredicateRegistry;
  /** Optional: embeddings for hybrid recall. Omitted in unit tests. */
  provider?: ProviderClient;
  /** Injectable clock so transaction time is deterministic in tests. */
  now?: () => Date;
  /**
   * Enable the LLM-judged contradiction path (cross-Predicate, off the critical
   * demo path). Requires `provider`. Default off so the demo stays deterministic.
   */
  enableContradiction?: boolean;
}

export interface FactSummary {
  id: string;
  subject: string;
  predicate: string;
  object: string;
}

/**
 * How one extracted name resolved during ingest (PRD US-10). The resolver already
 * decides this; surfacing it lets a caller SEE when a variant was fuzzy-merged into
 * an existing Entity (e.g. "Zachery" → "Zachary") and catch a wrong merge, instead
 * of the decision happening silently.
 */
export interface EntityResolution {
  /** The name as it appeared in the Source text. */
  input: string;
  /** The Entity it resolved to (existing match, or newly created). */
  resolvedTo: string;
  /** exact / fuzzy match against an existing Entity, or a new Entity created. */
  reason: "exact" | "fuzzy" | "new";
  /** Trigram similarity to the matched Entity (fuzzy matches only). */
  similarity?: number;
}

export interface RememberSummary {
  sourceId: string;
  factsCreated: FactSummary[];
  factsSuperseded: FactSummary[];
  /**
   * Facts already Current and re-stated by this Source (ADR 0005). No new Fact
   * is created; the Source is recorded as additional provenance. Distinguishes
   * "we learned this again" from "this changed" (factsSuperseded).
   */
  factsReaffirmed: FactSummary[];
  /**
   * One entry per distinct name mentioned in the Source, recording how entity
   * resolution placed it (exact/fuzzy/new). Surfaces fuzzy merges for review.
   */
  entitiesResolved: EntityResolution[];
}

export async function remember(
  deps: RememberDeps,
  text: string,
  sourceLabel: string | null = null,
): Promise<RememberSummary> {
  const { store, extractor, resolver, registry, provider } = deps;
  const clock = deps.now ?? (() => new Date());

  // Extract BEFORE any write, so a bad-output failure leaves the graph untouched
  // (no orphan Source). Throws ExtractionError on malformed LLM output.
  const knownEntities = await store.listEntityNames();
  const extracted = await extractor.extract(text, knownEntities);

  const source = await store.insertSource(text, sourceLabel);
  const summary: RememberSummary = {
    sourceId: source.id,
    factsCreated: [],
    factsSuperseded: [],
    factsReaffirmed: [],
    entitiesResolved: [],
  };

  // Resolve each name to an Entity, recording how it resolved (first occurrence of
  // a given input name wins — the decision made against the pre-existing graph).
  const resolutions = new Map<string, EntityResolution>();
  const resolveAndRecord = async (name: string): Promise<Entity> => {
    const result = await resolver.resolve(name);
    let entity: Entity;
    let reason: EntityResolution["reason"];
    if (result.entityId) {
      const matched = await store.getEntity(result.entityId);
      if (matched) {
        entity = matched;
        reason = result.reason === "exact" ? "exact" : "fuzzy";
      } else {
        entity = await store.upsertEntity(name); // matched row vanished — treat as new
        reason = "new";
      }
    } else {
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

    // Reaffirmation (ADR 0005): this exact Fact (same subject -> predicate ->
    // object) is already Current. Don't create a duplicate or supersede anything
    // — just record this Source as additional provenance and move on.
    const existing = currentFacts.find((c) => c.objectId === object.id);
    if (existing) {
      await store.addFactSource(existing.id, source.id);
      summary.factsReaffirmed.push({
        id: existing.id,
        subject: subject.name,
        predicate: fact.predicate,
        object: object.name,
      });
      continue;
    }

    const candidates = currentFacts.map(toCandidateFact);
    const plan = resolveSupersession({
      newFact: { predicate: fact.predicate, validAt: fact.validAt },
      candidateFacts: candidates,
      registry,
      now: clock(),
    });

    const { closed, inserted } = await applySupersessionPlan(store, plan, {
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
      });
    }

    // Best-effort embedding for hybrid recall — never blocks or fails the write.
    if (provider) {
      try {
        const [embedding] = await provider.embed([`${subject.name} ${fact.predicate} ${object.name}`]);
        if (embedding) await store.setFactEmbedding(inserted.id, embedding);
      } catch {
        // embedding is best-effort; recall still works on keyword + temporal filter
      }
    }

    // LLM-judged contradiction (off the critical demo path). Catches cross-
    // Predicate conflicts cardinality can't (works-at vs left). Reuses slice 03's
    // direction rule. Best-effort: a judge failure never breaks ingestion.
    if (deps.enableContradiction && provider && inserted.expiredAt === null) {
      const contradicted = await resolveContradictions(
        { store, provider, now: clock, model: undefined },
        {
          id: inserted.id,
          subjectId: subject.id,
          subject: subject.name,
          predicate: fact.predicate,
          object: object.name,
          validAt: fact.validAt,
        },
      );
      for (const c of contradicted) {
        if (c.id === inserted.id) continue; // the new Fact closed itself (out-of-order)
        const closedObject = await store.getEntity(c.objectId);
        summary.factsSuperseded.push({
          id: c.id,
          subject: subject.name,
          predicate: c.predicate,
          object: closedObject?.name ?? c.objectId,
        });
      }
    }
  }

  summary.entitiesResolved = [...resolutions.values()];
  return summary;
}

import type { Entity } from "./domain/types.js";
import type { TemporalGraphStore } from "./db/store.js";
import type { Extractor } from "./extraction/types.js";
import type { EntityResolver } from "./resolution/entity-resolver.js";
import type { PredicateRegistry } from "./supersession/registry.js";
import type { ProviderClient } from "./provider/types.js";
import { applySupersessionPlan } from "./supersession/apply.js";
import { decideFact } from "./supersession/decide.js";
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
 * A Fact retired by this ingest, tagged with WHY it closed. `cardinality`: a
 * single-valued Predicate received a new object (same Predicate, e.g. reports-to
 * Alice → reports-to Bob). `contradiction`: an LLM-judged cross-Predicate conflict
 * (e.g. "works-at Acme" retired by "left Acme"). The two are otherwise
 * indistinguishable in the summary — and a contradiction retires a Fact whose
 * predicate DIFFERS from the one just stated — so this flag is how a caller tells
 * a routine update apart from a semantic conflict.
 */
export interface SupersededFact extends FactSummary {
  reason: "cardinality" | "contradiction";
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
  factsSuperseded: SupersededFact[];
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
          reason: "contradiction",
        });
      }
    }
  }

  summary.entitiesResolved = [...resolutions.values()];
  return summary;
}

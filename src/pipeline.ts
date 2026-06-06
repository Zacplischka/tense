import type { Entity } from "./domain/types.js";
import type { RecalledFact, TemporalGraphStore } from "./db/store.js";
import type { Extractor } from "./extraction/types.js";
import type { EntityResolver } from "./resolution/entity-resolver.js";
import type { PredicateRegistry } from "./supersession/registry.js";
import type { ProviderClient } from "./provider/types.js";
import { resolveSupersession } from "./supersession/resolver.js";
import { applySupersessionPlan, toCandidateFact } from "./supersession/apply.js";

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
}

export interface FactSummary {
  id: string;
  subject: string;
  predicate: string;
  object: string;
}

export interface RememberSummary {
  sourceId: string;
  factsCreated: FactSummary[];
  factsSuperseded: FactSummary[];
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
  const summary: RememberSummary = { sourceId: source.id, factsCreated: [], factsSuperseded: [] };

  for (const fact of extracted.facts) {
    const subject = await resolveOrCreate(resolver, store, fact.subject);
    const object = await resolveOrCreate(resolver, store, fact.object);

    const candidates = (await store.currentFactsFor(subject.id, fact.predicate)).map(toCandidateFact);
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
  }

  return summary;
}

/** Recall Current Facts matching the query, each with its Source citation. */
export async function recall(store: TemporalGraphStore, query: string): Promise<RecalledFact[]> {
  return store.recallCurrent(query);
}

/** Resolve a name to an existing Entity (exact/fuzzy) or create a new one. */
async function resolveOrCreate(
  resolver: EntityResolver,
  store: TemporalGraphStore,
  name: string,
): Promise<Entity> {
  const result = await resolver.resolve(name);
  if (result.entityId) {
    const existing = await store.getEntity(result.entityId);
    if (existing) return existing;
  }
  return store.upsertEntity(name);
}

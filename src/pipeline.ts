import type { Extractor } from "./extraction/stub.js";
import type { FactClose, RecalledFact, TemporalGraphStore } from "./db/store.js";

/**
 * TEMPORARY single-valued predicate set for the walking skeleton (slice 01).
 *
 * This is the minimum needed to drive supersession-shaped data through the real
 * bi-temporal columns and the Current partial index. It is deliberately a flat
 * set, NOT the policy: slice 03 replaces it with the predicate registry +
 * deterministic resolver (cardinality path, valid-time direction rule,
 * out-of-order/born-expired handling), and slice 07 rewires this pipeline to it.
 */
const SINGLE_VALUED_PREDICATES = new Set(["reports-to", "lives-in"]);

export interface RememberSummary {
  sourceId: string;
  factsCreated: Array<{ id: string; subject: string; predicate: string; object: string }>;
  factsSuperseded: Array<{ id: string; subject: string; predicate: string; object: string }>;
}

/**
 * Ingest a Source: extract Facts, resolve Entities, persist. A new Current Fact
 * on a single-valued Predicate closes the prior one via the store's atomic
 * Supersession boundary.
 */
export async function remember(
  store: TemporalGraphStore,
  extractor: Extractor,
  text: string,
  sourceLabel: string | null = null,
): Promise<RememberSummary> {
  const source = await store.insertSource(text, sourceLabel);
  const extracted = extractor.extract(text);

  const summary: RememberSummary = { sourceId: source.id, factsCreated: [], factsSuperseded: [] };

  for (const fact of extracted) {
    const subject = await store.upsertEntity(fact.subject);
    const object = await store.upsertEntity(fact.object);

    const newFact = {
      subjectId: subject.id,
      predicate: fact.predicate,
      objectId: object.id,
      sourceId: source.id,
      validAt: fact.validAt,
      invalidAt: null,
      expiredAt: null,
    };

    if (SINGLE_VALUED_PREDICATES.has(fact.predicate)) {
      const priorCurrent = await store.currentFactsFor(subject.id, fact.predicate);
      const now = new Date();
      // Close the prior Current Fact: valid-time end at the new Fact's valid_at
      // when known, else transaction time (the documented degenerate fallback —
      // never silently reused as transaction time). Transaction-time end is now.
      const closes: FactClose[] = priorCurrent.map((prior) => ({
        factId: prior.id,
        invalidAt: fact.validAt ?? now,
        expiredAt: now,
      }));

      const { closed, inserted } = await store.supersedeAndInsert(closes, newFact);
      summary.factsCreated.push(describe(inserted.id, subject.name, fact.predicate, object.name));
      for (const c of closed) {
        // The closed Fact has its own object (e.g. the prior manager), distinct
        // from the incoming Fact's object — resolve it rather than mislabeling.
        const closedObject = await store.getEntity(c.objectId);
        summary.factsSuperseded.push(
          describe(c.id, subject.name, fact.predicate, closedObject?.name ?? c.objectId),
        );
      }
    } else {
      const inserted = await store.insertFact(newFact);
      summary.factsCreated.push(describe(inserted.id, subject.name, fact.predicate, object.name));
    }
  }

  return summary;
}

/** Recall Current Facts matching the query, each with its Source citation. */
export async function recall(store: TemporalGraphStore, query: string): Promise<RecalledFact[]> {
  return store.recallCurrent(query);
}

function describe(id: string, subject: string, predicate: string, object: string) {
  return { id, subject, predicate, object };
}

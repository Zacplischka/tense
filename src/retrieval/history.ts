import type { RecalledFact, TemporalGraphStore } from "../db/store.js";
import type { EntityResolver } from "../resolution/entity-resolver.js";

export interface HistoryDeps {
  store: TemporalGraphStore;
  resolver: EntityResolver;
}

/**
 * The Supersession chain for a subject (and optional Predicate): every Fact, past
 * and present, in chronological order — the "show your work" view. The subject is
 * resolved by name (exact/fuzzy) so variants find the same Entity; an unknown
 * subject yields an empty chain.
 */
export async function history(
  deps: HistoryDeps,
  entity: string,
  predicate?: string,
): Promise<RecalledFact[]> {
  const resolved = await deps.resolver.resolve(entity);
  if (!resolved.entityId) return [];
  return deps.store.history(resolved.entityId, predicate);
}

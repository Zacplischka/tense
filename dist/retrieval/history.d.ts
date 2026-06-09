import type { FactChange, TemporalGraphStore } from "../db/store.js";
import type { EntityResolver } from "../resolution/entity-resolver.js";
export interface HistoryDeps {
    store: TemporalGraphStore;
    resolver: EntityResolver;
}
/**
 * The Supersession chain for a subject (and optional Predicate): every Fact, past
 * and present, in chronological order — the "show your work" view. The subject is
 * resolved by name (exact/fuzzy) so variants find the same Entity; an unknown
 * subject yields an empty chain. Each Fact carries both transaction-time stamps
 * (`learnedAt`/`retiredAt`) so the chain shows when each link was retired, not just
 * its valid interval.
 */
export declare function history(deps: HistoryDeps, entity: string, predicate?: string): Promise<FactChange[]>;

import type pg from "pg";
import { normalizeName } from "../db/store.js";

/**
 * Entity resolution so the same real-world Entity under name variants resolves
 * to one node instead of forking the graph (PRD US-10). Cascade:
 *   1. exact normalized-name match
 *   2. pg_trgm trigram fuzzy match (typos / variants like Zach↔Zachary)
 *   3. short-name guard — reject a fuzzy match when BOTH names are short, so
 *      similar-but-distinct short names (Zach vs Zara) never merge.
 * No LLM tiebreak in v1 (deferred).
 */

export type ResolutionReason = "exact" | "fuzzy" | "new";

export interface ResolutionResult {
  /** Existing Entity id, or null to signal "create a new Entity". */
  entityId: string | null;
  reason: ResolutionReason;
  matched?: { id: string; name: string; similarity: number };
}

export interface EntityResolverOptions {
  /** Minimum trigram similarity to accept a fuzzy match (0..1). */
  fuzzyThreshold?: number;
  /** Names this length or shorter are "short" for the guard. */
  shortNameLen?: number;
}

export class EntityResolver {
  private readonly fuzzyThreshold: number;
  private readonly shortNameLen: number;

  constructor(
    private readonly pool: pg.Pool,
    opts: EntityResolverOptions = {},
  ) {
    this.fuzzyThreshold = opts.fuzzyThreshold ?? 0.4;
    this.shortNameLen = opts.shortNameLen ?? 4;
  }

  async resolve(candidateName: string): Promise<ResolutionResult> {
    const normalized = normalizeName(candidateName);

    // 1. Exact normalized-name match.
    const exact = await this.pool.query(
      "SELECT id FROM entities WHERE normalized_name = $1",
      [normalized],
    );
    if (exact.rows[0]) {
      return { entityId: exact.rows[0].id, reason: "exact" };
    }

    // 2. Trigram fuzzy match (best candidate above threshold). similarity() is
    // from pg_trgm; a seq scan is fine at demo scale.
    const fuzzy = await this.pool.query(
      `SELECT id, name, normalized_name, similarity(normalized_name, $1) AS sim
       FROM entities
       WHERE similarity(normalized_name, $1) >= $2
       ORDER BY sim DESC, length(normalized_name) ASC
       LIMIT 1`,
      [normalized, this.fuzzyThreshold],
    );
    const best = fuzzy.rows[0];

    if (best) {
      // 3. Short-name guard: don't merge two short names even if they're similar
      // (Zach/Zara). Real variants (Zach/Zachary) differ in length, so at least
      // one side is long and the guard lets them through.
      const bothShort =
        normalized.length <= this.shortNameLen &&
        String(best.normalized_name).length <= this.shortNameLen;
      if (!bothShort) {
        return {
          entityId: best.id,
          reason: "fuzzy",
          matched: { id: best.id, name: best.name, similarity: Number(best.sim) },
        };
      }
    }

    return { entityId: null, reason: "new" };
  }
}

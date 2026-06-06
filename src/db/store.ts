import type pg from "pg";
import type { Entity, Fact, Source } from "../domain/types.js";

/** Fields needed to insert a new Fact. Timestamps default at the DB. */
export interface NewFact {
  subjectId: string;
  predicate: string;
  objectId: string;
  sourceId: string;
  validAt: Date | null;
  invalidAt: Date | null;
  /**
   * Transaction-time end at insert. Normally null (Fact is born Current); set to
   * a timestamp only for a "born-expired" Fact — one ingested out of order whose
   * valid time predates an existing Fact (slice 03's direction rule).
   */
  expiredAt: Date | null;
}

/**
 * Instruction to close one existing Fact during a Supersession. The resolver
 * (slice 03) decides the values; the store only applies them. Keeping both ends
 * explicit prevents conflating valid and transaction time:
 *   invalidAt -> valid-time end (when the Fact stopped being true in the world)
 *   expiredAt -> transaction-time end (when the system retired it; drives Current)
 */
export interface FactClose {
  factId: string;
  invalidAt: Date | null;
  expiredAt: Date;
}

/** A Fact resolved for reading: entity names + Source text inlined. */
export interface RecalledFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validAt: Date | null;
  invalidAt: Date | null;
  current: boolean;
  source: { id: string; label: string | null; text: string };
}

const FACT_COLUMNS =
  "id, subject_id, predicate, object_id, source_id, valid_at, invalid_at, created_at, expired_at";

function mapFact(row: Record<string, unknown>): Fact {
  return {
    id: row.id as string,
    subjectId: row.subject_id as string,
    predicate: row.predicate as string,
    objectId: row.object_id as string,
    sourceId: row.source_id as string,
    validAt: (row.valid_at as Date | null) ?? null,
    invalidAt: (row.invalid_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    expiredAt: (row.expired_at as Date | null) ?? null,
  };
}

function mapEntity(row: Record<string, unknown>): Entity {
  return {
    id: row.id as string,
    name: row.name as string,
    normalizedName: row.normalized_name as string,
    createdAt: row.created_at as Date,
  };
}

function mapSource(row: Record<string, unknown>): Source {
  return {
    id: row.id as string,
    label: (row.label as string | null) ?? null,
    text: row.text as string,
    createdAt: row.created_at as Date,
  };
}

/** Normalized form used for exact entity matching (slice 06 deepens this). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Render a number[] as a pgvector literal: [0.1,0.2,...]. */
export function formatVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Shared SELECT for reading Facts with entity names + Source inlined. */
const RECALL_SELECT = `
  SELECT f.id, f.predicate, f.valid_at, f.invalid_at, f.expired_at,
         subj.name AS subject_name, obj.name AS object_name,
         s.id AS source_id, s.label AS source_label, s.text AS source_text
  FROM facts f
  JOIN entities subj ON subj.id = f.subject_id
  JOIN entities obj  ON obj.id  = f.object_id
  JOIN sources  s    ON s.id    = f.source_id`;

/** Searchable text for a Fact (predicate hyphens -> spaces so they tokenize). */
const FACT_TSVECTOR =
  "to_tsvector('english', subj.name || ' ' || replace(f.predicate, '-', ' ') || ' ' || obj.name)";

function mapRecalledRow(row: Record<string, unknown>): RecalledFact {
  return {
    id: row.id as string,
    subject: row.subject_name as string,
    predicate: row.predicate as string,
    object: row.object_name as string,
    validAt: (row.valid_at as Date | null) ?? null,
    invalidAt: (row.invalid_at as Date | null) ?? null,
    current: row.expired_at === null,
    source: {
      id: row.source_id as string,
      label: (row.source_label as string | null) ?? null,
      text: row.source_text as string,
    },
  };
}

/** Clamp an externally-supplied LIMIT to a safe positive integer. */
function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit) || 1, 1), 200);
}

/**
 * Postgres persistence for the temporal graph. Owns the mechanics of storage and
 * the atomic Supersession boundary — but holds no supersession *policy* (which
 * Fact closes, how direction is decided): that lives in the resolver (slice 03),
 * which calls `supersedeAndInsert` with values it computed.
 */
export class TemporalGraphStore {
  constructor(private readonly pool: pg.Pool) {}

  async insertSource(text: string, label: string | null = null): Promise<Source> {
    const { rows } = await this.pool.query(
      "INSERT INTO sources (text, label) VALUES ($1, $2) RETURNING id, label, text, created_at",
      [text, label],
    );
    return mapSource(rows[0]);
  }

  /**
   * Exact-match-or-create by normalized name. Real entity resolution (fuzzy
   * matching, short-name guards) is slice 06; this is the seed it deepens.
   */
  async upsertEntity(name: string): Promise<Entity> {
    const normalized = normalizeName(name);
    const existing = await this.pool.query(
      "SELECT id, name, normalized_name, created_at FROM entities WHERE normalized_name = $1",
      [normalized],
    );
    if (existing.rowCount) return mapEntity(existing.rows[0]);

    const { rows } = await this.pool.query(
      `INSERT INTO entities (name, normalized_name) VALUES ($1, $2)
       ON CONFLICT (normalized_name) DO UPDATE SET name = entities.name
       RETURNING id, name, normalized_name, created_at`,
      [name, normalized],
    );
    return mapEntity(rows[0]);
  }

  async insertFact(fact: NewFact): Promise<Fact> {
    const { rows } = await this.pool.query(
      `INSERT INTO facts (subject_id, predicate, object_id, source_id, valid_at, invalid_at, expired_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${FACT_COLUMNS}`,
      [
        fact.subjectId,
        fact.predicate,
        fact.objectId,
        fact.sourceId,
        fact.validAt,
        fact.invalidAt,
        fact.expiredAt,
      ],
    );
    return mapFact(rows[0]);
  }

  /** All Current Facts for a subject (any Predicate) with object names — the
   * contradiction path's candidate set. */
  async currentFactsForSubject(
    subjectId: string,
  ): Promise<Array<{ id: string; predicate: string; object: string; validAt: Date | null; createdAt: Date }>> {
    const { rows } = await this.pool.query(
      `SELECT f.id, f.predicate, obj.name AS object, f.valid_at, f.created_at
       FROM facts f JOIN entities obj ON obj.id = f.object_id
       WHERE f.subject_id = $1 AND f.expired_at IS NULL
       ORDER BY f.created_at ASC`,
      [subjectId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      predicate: r.predicate as string,
      object: r.object as string,
      validAt: (r.valid_at as Date | null) ?? null,
      createdAt: r.created_at as Date,
    }));
  }

  /** Atomically close (expire) a set of Facts — used by the contradiction path. */
  async expireFacts(closes: FactClose[]): Promise<Fact[]> {
    if (closes.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const closed: Fact[] = [];
      for (const close of closes) {
        const { rows } = await client.query(
          `UPDATE facts SET invalid_at = $2, expired_at = $3
           WHERE id = $1 AND expired_at IS NULL
           RETURNING ${FACT_COLUMNS}`,
          [close.factId, close.invalidAt, close.expiredAt],
        );
        if (rows[0]) closed.push(mapFact(rows[0]));
      }
      await client.query("COMMIT");
      return closed;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Current Facts for a (subject, predicate) — the supersession candidates. */
  async currentFactsFor(subjectId: string, predicate: string): Promise<Fact[]> {
    const { rows } = await this.pool.query(
      `SELECT ${FACT_COLUMNS} FROM facts
       WHERE subject_id = $1 AND predicate = $2 AND expired_at IS NULL
       ORDER BY created_at ASC`,
      [subjectId, predicate],
    );
    return rows.map(mapFact);
  }

  /**
   * The atomic Supersession boundary: close zero or more existing Facts and
   * insert the new one in a single transaction, so no reader (recall, viewer)
   * ever observes a torn state. Closed Facts are expired, never deleted.
   */
  async supersedeAndInsert(
    closes: FactClose[],
    newFact: NewFact,
  ): Promise<{ closed: Fact[]; inserted: Fact }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const closed: Fact[] = [];
      for (const close of closes) {
        const { rows } = await client.query(
          `UPDATE facts SET invalid_at = $2, expired_at = $3
           WHERE id = $1 AND expired_at IS NULL
           RETURNING ${FACT_COLUMNS}`,
          [close.factId, close.invalidAt, close.expiredAt],
        );
        if (rows[0]) closed.push(mapFact(rows[0]));
      }

      const { rows } = await client.query(
        `INSERT INTO facts (subject_id, predicate, object_id, source_id, valid_at, invalid_at, expired_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${FACT_COLUMNS}`,
        [
          newFact.subjectId,
          newFact.predicate,
          newFact.objectId,
          newFact.sourceId,
          newFact.validAt,
          newFact.invalidAt,
          newFact.expiredAt,
        ],
      );

      await client.query("COMMIT");
      return { closed, inserted: mapFact(rows[0]) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Store a Fact's embedding (pgvector). Best-effort; never blocks the write. */
  async setFactEmbedding(factId: string, embedding: number[]): Promise<void> {
    await this.pool.query("UPDATE facts SET embedding = $2::vector WHERE id = $1", [
      factId,
      formatVector(embedding),
    ]);
  }

  /** Whether a Fact has an embedding stored (for tests/diagnostics). */
  async hasEmbedding(factId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT embedding IS NOT NULL AS has FROM facts WHERE id = $1",
      [factId],
    );
    return rows[0]?.has === true;
  }

  /**
   * Record that a Source asserted a Fact (Reaffirmation, ADR 0005). Idempotent:
   * re-linking the same (fact, source) pair is a no-op. Called for the origin
   * Source when a Fact is first created and for every later Source that re-states
   * an already-Current Fact.
   */
  async addFactSource(factId: string, sourceId: string): Promise<void> {
    await this.pool.query(
      "INSERT INTO fact_sources (fact_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [factId, sourceId],
    );
  }

  /** How many distinct Sources have asserted a Fact ("reinforced N times"). */
  async countFactSources(factId: string): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT count(*)::int AS n FROM fact_sources WHERE fact_id = $1",
      [factId],
    );
    return (rows[0]?.n as number) ?? 0;
  }

  async getEntity(id: string): Promise<Entity | null> {
    const { rows } = await this.pool.query(
      "SELECT id, name, normalized_name, created_at FROM entities WHERE id = $1",
      [id],
    );
    return rows[0] ? mapEntity(rows[0]) : null;
  }

  /** Entity names (capped) to hint extraction toward reusing existing Entities. */
  async listEntityNames(limit = 200): Promise<string[]> {
    const { rows } = await this.pool.query("SELECT name FROM entities ORDER BY created_at DESC LIMIT $1", [
      limit,
    ]);
    return rows.map((r) => r.name as string);
  }

  async getFact(id: string): Promise<Fact | null> {
    const { rows } = await this.pool.query(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = $1`, [id]);
    return rows[0] ? mapFact(rows[0]) : null;
  }

  /**
   * Browse temporally-filtered Facts (no relevance ranking) — used for an empty
   * query. `asOf` null returns Current Facts (`expired_at IS NULL`); a date
   * returns Facts valid at that instant (`valid_at <= T AND (invalid_at IS NULL
   * OR invalid_at > T)`), per ADR 0002's point-in-time formula.
   */
  async recallByTemporal(asOf: Date | null, limit = 50): Promise<RecalledFact[]> {
    const lim = clampLimit(limit);
    if (asOf === null) {
      const { rows } = await this.pool.query(
        `${RECALL_SELECT} WHERE f.expired_at IS NULL ORDER BY f.created_at DESC LIMIT ${lim}`,
      );
      return rows.map(mapRecalledRow);
    }
    const { rows } = await this.pool.query(
      `${RECALL_SELECT}
       WHERE f.valid_at IS NOT NULL AND f.valid_at <= $1 AND (f.invalid_at IS NULL OR f.invalid_at > $1)
       ORDER BY f.valid_at DESC LIMIT ${lim}`,
      [asOf],
    );
    return rows.map(mapRecalledRow);
  }

  /** Rank Fact ids by semantic similarity to a query embedding, temporally filtered. */
  async rankBySemantic(queryEmbedding: number[], asOf: Date | null, limit = 20): Promise<string[]> {
    const lim = clampLimit(limit);
    const vec = formatVector(queryEmbedding);
    if (asOf === null) {
      const { rows } = await this.pool.query(
        `SELECT id FROM facts
         WHERE embedding IS NOT NULL AND expired_at IS NULL
         ORDER BY embedding <=> $1::vector LIMIT ${lim}`,
        [vec],
      );
      return rows.map((r) => r.id as string);
    }
    const { rows } = await this.pool.query(
      `SELECT id FROM facts
       WHERE embedding IS NOT NULL
         AND valid_at IS NOT NULL AND valid_at <= $2 AND (invalid_at IS NULL OR invalid_at > $2)
       ORDER BY embedding <=> $1::vector LIMIT ${lim}`,
      [vec, asOf],
    );
    return rows.map((r) => r.id as string);
  }

  /** Rank Fact ids by Postgres full-text relevance, temporally filtered. */
  async rankByKeyword(query: string, asOf: Date | null, limit = 20): Promise<string[]> {
    const lim = clampLimit(limit);
    const temporal =
      asOf === null
        ? "f.expired_at IS NULL"
        : "f.valid_at IS NOT NULL AND f.valid_at <= $2 AND (f.invalid_at IS NULL OR f.invalid_at > $2)";
    const params: unknown[] = asOf === null ? [query] : [query, asOf];
    const { rows } = await this.pool.query(
      `SELECT f.id,
              ts_rank(${FACT_TSVECTOR}, plainto_tsquery('english', $1)) AS rank
       FROM facts f
       JOIN entities subj ON subj.id = f.subject_id
       JOIN entities obj  ON obj.id  = f.object_id
       WHERE plainto_tsquery('english', $1) @@ ${FACT_TSVECTOR} AND ${temporal}
       ORDER BY rank DESC LIMIT ${lim}`,
      params,
    );
    return rows.map((r) => r.id as string);
  }

  /**
   * The full Supersession chain for a subject (all Facts, Current + superseded),
   * optionally narrowed to one Predicate. Ordered chronologically by valid time,
   * falling back to transaction time when valid_at is null, with transaction time
   * as the tiebreak — so a closed Fact precedes the Current one that replaced it.
   */
  async history(subjectId: string, predicate?: string): Promise<RecalledFact[]> {
    const params: unknown[] = [subjectId];
    let predicateClause = "";
    if (predicate) {
      params.push(predicate);
      predicateClause = "AND f.predicate = $2";
    }
    const { rows } = await this.pool.query(
      `${RECALL_SELECT}
       WHERE f.subject_id = $1 ${predicateClause}
       ORDER BY COALESCE(f.valid_at, f.created_at) ASC, f.created_at ASC`,
      params,
    );
    return rows.map(mapRecalledRow);
  }

  /** All Facts (Current + superseded), with names + Source — for the eval harness. */
  async allFacts(): Promise<RecalledFact[]> {
    const { rows } = await this.pool.query(`${RECALL_SELECT} ORDER BY f.created_at ASC`);
    return rows.map(mapRecalledRow);
  }

  /**
   * Top-k Facts by cosine similarity to a query embedding over ALL Facts — NO
   * temporal filter. This is the fair vector baseline's retrieval (slice 13): it
   * has no bi-temporal model, so superseded Facts are eligible and it must rely
   * on a recency tiebreak.
   */
  async baselineCandidates(
    queryEmbedding: number[],
    k = 5,
  ): Promise<Array<{ object: string; validAt: Date | null; createdAt: Date }>> {
    const { rows } = await this.pool.query(
      `SELECT obj.name AS object, f.valid_at, f.created_at
       FROM facts f JOIN entities obj ON obj.id = f.object_id
       WHERE f.embedding IS NOT NULL
       ORDER BY f.embedding <=> $1::vector
       LIMIT ${clampLimit(k)}`,
      [formatVector(queryEmbedding)],
    );
    return rows.map((r) => ({
      object: r.object as string,
      validAt: (r.valid_at as Date | null) ?? null,
      createdAt: r.created_at as Date,
    }));
  }

  /** Load full RecalledFact details for ids (caller preserves the fused order). */
  async loadRecalledByIds(ids: string[]): Promise<Map<string, RecalledFact>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query(`${RECALL_SELECT} WHERE f.id = ANY($1::uuid[])`, [ids]);
    return new Map(rows.map((row) => [row.id as string, mapRecalledRow(row)]));
  }
}

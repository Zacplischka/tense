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

  async getEntity(id: string): Promise<Entity | null> {
    const { rows } = await this.pool.query(
      "SELECT id, name, normalized_name, created_at FROM entities WHERE id = $1",
      [id],
    );
    return rows[0] ? mapEntity(rows[0]) : null;
  }

  async getFact(id: string): Promise<Fact | null> {
    const { rows } = await this.pool.query(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = $1`, [id]);
    return rows[0] ? mapFact(rows[0]) : null;
  }

  /**
   * Slice-01 recall: Current Facts whose subject/object/predicate match the
   * query (substring), each with its Source. Hybrid semantic+keyword retrieval
   * with RRF and the as-of temporal filter is slice 09.
   */
  async recallCurrent(query: string): Promise<RecalledFact[]> {
    const { rows } = await this.pool.query(
      `SELECT f.id, f.predicate, f.valid_at, f.invalid_at, f.expired_at,
              subj.name AS subject_name, obj.name AS object_name,
              s.id AS source_id, s.label AS source_label, s.text AS source_text
       FROM facts f
       JOIN entities subj ON subj.id = f.subject_id
       JOIN entities obj  ON obj.id  = f.object_id
       JOIN sources  s    ON s.id    = f.source_id
       WHERE f.expired_at IS NULL
         AND ($1 = ''
              OR subj.name ILIKE '%' || $1 || '%'
              OR obj.name  ILIKE '%' || $1 || '%'
              OR f.predicate ILIKE '%' || $1 || '%')
       ORDER BY f.created_at DESC`,
      [query.trim()],
    );

    return rows.map((row) => ({
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
    }));
  }
}

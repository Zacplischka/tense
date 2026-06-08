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

/**
 * A high-level snapshot of the graph for introspection (the `stats` tool): how
 * many Entities/Sources exist, how many Facts are Current vs superseded, and a
 * per-Predicate breakdown. Read-only — never touches the supersession path.
 */
export interface GraphStats {
  entities: number;
  sources: number;
  facts: { total: number; current: number; superseded: number };
  /** Per-Predicate counts, ordered by total descending then predicate ascending. */
  predicates: Array<{ predicate: string; current: number; total: number }>;
}

/**
 * One Entity in the `entities` listing: its name plus how many Current Facts
 * touch it (as subject OR object) — a "how connected is this node" degree that
 * lets an agent browse the graph by Entity rather than by relevance query.
 */
export interface EntitySummary {
  id: string;
  name: string;
  /** Count of Current Facts where this Entity is the subject or the object. */
  currentFacts: number;
  /**
   * Distinct Predicates of those Current Facts (sorted) — the Entity's relationship
   * "shape", so a caller browsing can see what KINDS of Facts touch it (e.g.
   * reports-to, knows) and pick its next move (history-by-predicate / recall).
   */
  predicates: string[];
}

/**
 * One ingested Source in the `sources` listing — a provenance-audit view: its
 * label, when it was ingested, how many Facts cite it (origin or Reaffirmation),
 * and a short text preview. Full Source text comes back via `recall` (each Fact's
 * `source.text`); this keeps the listing economical.
 */
export interface SourceSummary {
  id: string;
  label: string | null;
  createdAt: Date;
  /** Number of Facts that cite this Source (origin or Reaffirmation, ADR 0005). */
  facts: number;
  /** First ~200 chars of the Source text (truncated with … when longer). */
  preview: string;
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
  /**
   * Transaction time: when the system first learned this Fact (created_at) — the
   * other bi-temporal axis from `validAt`/`invalidAt` (when it was true in the
   * world). `current` says IF the Fact has been retired; `learnedAt` says WHEN it
   * entered memory, so a caller can tell "true since 2020 but only learned last
   * week" apart from a long-held belief.
   */
  learnedAt: Date;
  /**
   * The origin Source (first to assert this Fact). `text` is the full ingested
   * chunk; it is omitted when recall is called with `include_source_text: false`
   * (a token-lean mode for long Sources — re-fetch full text via the `sources`
   * tool or a default recall). Always present on `history`/`changes`.
   */
  source: { id: string; label: string | null; text?: string };
  /**
   * How many distinct Sources assert this Fact (origin + Reaffirmations, ADR
   * 0005) — a provenance-strength signal so a reader can weigh a multiply-
   * confirmed Fact above a single mention. Always ≥1 for pipeline-ingested Facts.
   */
  reinforcedBy: number;
  /**
   * The Sources that assert this Fact (origin + Reaffirmations, chronological) —
   * the provenance behind `reinforcedBy` (`citedBy.length === reinforcedBy`). Only
   * populated on opt-in (recall's `include_sources`); omitted by default so the
   * common path stays lean. Lets a caller audit WHICH Sources back a claim.
   */
  citedBy?: Array<{ id: string; label: string | null }>;
}

/**
 * A Fact whose **transaction time** changed within a window — the `changes` feed.
 * Extends {@link RecalledFact} (which already carries `learnedAt`) with the
 * retirement stamp, so a caller can tell a newly learned Fact from one that was
 * just superseded. Distinct from valid-time recall.
 */
export interface FactChange extends RecalledFact {
  /** Transaction time: when the system retired it (expired_at); null = still Current. */
  retiredAt: Date | null;
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
  SELECT f.id, f.predicate, f.valid_at, f.invalid_at, f.expired_at, f.created_at AS tx_created,
         subj.name AS subject_name, obj.name AS object_name,
         s.id AS source_id, s.label AS source_label, s.text AS source_text,
         (SELECT count(*)::int FROM fact_sources fs WHERE fs.fact_id = f.id) AS reinforced_by
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
    learnedAt: row.tx_created as Date,
    source: {
      id: row.source_id as string,
      label: (row.source_label as string | null) ?? null,
      text: row.source_text as string,
    },
    reinforcedBy: (row.reinforced_by as number) ?? 0,
  };
}

/**
 * A recall row plus its transaction-time retirement — the {@link FactChange} shape
 * shared by the `changes` feed and `history`. One construction point so the two
 * can't drift (mirrors the mapFact/mapEntity/mapSource/mapRecalledRow family).
 */
function mapFactChange(row: Record<string, unknown>): FactChange {
  return { ...mapRecalledRow(row), retiredAt: (row.expired_at as Date | null) ?? null };
}

/**
 * Clamp an externally-supplied LIMIT to a safe integer in [1, 200]. The result
 * is string-interpolated into `LIMIT ${lim}` (Postgres rejects a parameterized
 * LIMIT in some positions), so this is the guard that keeps a caller-supplied
 * limit — NaN, Infinity, a float, a negative, or an absurd value — from ever
 * reaching SQL as anything but a small positive integer. Always returns an
 * integer: floor first, then 0/NaN fall to 1, negatives clamp up to 1, and
 * anything over 200 (incl. Infinity) clamps down to 200.
 */
export function clampLimit(limit: number): number {
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

  /**
   * Close (expire) the given Facts on an already-open transaction client — the
   * shared mechanism behind BOTH supersession paths: cardinality
   * ({@link supersedeAndInsert}) and contradiction ({@link expireFacts}). The
   * `expired_at IS NULL` guard makes each close idempotent — re-closing an
   * already-closed Fact simply returns nothing for it. Runs on the caller's
   * client so it joins the caller's BEGIN/COMMIT; it does not manage the
   * transaction itself.
   */
  private async closeFactsTx(client: pg.PoolClient, closes: FactClose[]): Promise<Fact[]> {
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
    return closed;
  }

  /** Atomically close (expire) a set of Facts — used by the contradiction path. */
  async expireFacts(closes: FactClose[]): Promise<Fact[]> {
    if (closes.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const closed = await this.closeFactsTx(client, closes);
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

      const closed = await this.closeFactsTx(client, closes);

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
   * The transaction-time change feed (the `changes` tool): Facts the system
   * **learned** (`created_at >= since`) or **retired** (`expired_at >= since`)
   * since an instant, most-recent change first. This is the other half of the
   * bi-temporal model — *when the system knew*, distinct from valid-time recall
   * (*when it was true*) — and lets an agent sync incrementally ("what changed in
   * my memory since I last checked?"). A Fact created and superseded in the same
   * window appears once, with both `learnedAt` and `retiredAt` set.
   */
  async changesSince(since: Date, limit = 50): Promise<FactChange[]> {
    const lim = clampLimit(limit);
    const { rows } = await this.pool.query(
      `${RECALL_SELECT}
       WHERE f.created_at >= $1 OR (f.expired_at IS NOT NULL AND f.expired_at >= $1)
       ORDER BY GREATEST(f.created_at, COALESCE(f.expired_at, f.created_at)) DESC
       LIMIT ${lim}`,
      [since],
    );
    return rows.map(mapFactChange);
  }

  /**
   * Browse temporally-filtered Facts (no relevance ranking) — used for an empty
   * query. `asOf` null returns Current Facts (`expired_at IS NULL`); a date
   * returns Facts valid at that instant (`valid_at <= T AND (invalid_at IS NULL
   * OR invalid_at > T)`), per ADR 0002's point-in-time formula.
   */
  async recallByTemporal(
    asOf: Date | null,
    limit = 50,
    predicate: string | null = null,
    minReinforced: number | null = null,
  ): Promise<RecalledFact[]> {
    const lim = clampLimit(limit);
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (asOf === null) {
      clauses.push("f.expired_at IS NULL");
    } else {
      const i = params.push(asOf); // 1-based index of asOf
      clauses.push(`f.valid_at IS NOT NULL AND f.valid_at <= $${i} AND (f.invalid_at IS NULL OR f.invalid_at > $${i})`);
    }
    if (predicate) clauses.push(`f.predicate = $${params.push(predicate)}`);
    if (minReinforced && minReinforced > 0)
      clauses.push(`(SELECT count(*) FROM fact_sources fs WHERE fs.fact_id = f.id) >= $${params.push(minReinforced)}`);
    const order = asOf === null ? "f.created_at DESC" : "f.valid_at DESC";
    const { rows } = await this.pool.query(
      `${RECALL_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT ${lim}`,
      params,
    );
    return rows.map(mapRecalledRow);
  }

  /** Rank Fact ids by semantic similarity to a query embedding, temporally filtered. */
  async rankBySemantic(
    queryEmbedding: number[],
    asOf: Date | null,
    limit = 20,
    predicate: string | null = null,
    minReinforced: number | null = null,
  ): Promise<string[]> {
    const lim = clampLimit(limit);
    const params: unknown[] = [formatVector(queryEmbedding)]; // $1 = query vector
    const clauses = ["embedding IS NOT NULL"];
    if (asOf === null) {
      clauses.push("expired_at IS NULL");
    } else {
      const i = params.push(asOf);
      clauses.push(`valid_at IS NOT NULL AND valid_at <= $${i} AND (invalid_at IS NULL OR invalid_at > $${i})`);
    }
    if (predicate) clauses.push(`predicate = $${params.push(predicate)}`);
    if (minReinforced && minReinforced > 0)
      clauses.push(`(SELECT count(*) FROM fact_sources fs WHERE fs.fact_id = facts.id) >= $${params.push(minReinforced)}`);
    const { rows } = await this.pool.query(
      `SELECT id FROM facts WHERE ${clauses.join(" AND ")} ORDER BY embedding <=> $1::vector LIMIT ${lim}`,
      params,
    );
    return rows.map((r) => r.id as string);
  }

  /** Rank Fact ids by Postgres full-text relevance, temporally filtered. */
  async rankByKeyword(
    query: string,
    asOf: Date | null,
    limit = 20,
    predicate: string | null = null,
    minReinforced: number | null = null,
  ): Promise<string[]> {
    const lim = clampLimit(limit);
    const params: unknown[] = [query]; // $1 = query text
    const clauses = [`plainto_tsquery('english', $1) @@ ${FACT_TSVECTOR}`];
    if (asOf === null) {
      clauses.push("f.expired_at IS NULL");
    } else {
      const i = params.push(asOf);
      clauses.push(`f.valid_at IS NOT NULL AND f.valid_at <= $${i} AND (f.invalid_at IS NULL OR f.invalid_at > $${i})`);
    }
    if (predicate) clauses.push(`f.predicate = $${params.push(predicate)}`);
    if (minReinforced && minReinforced > 0)
      clauses.push(`(SELECT count(*) FROM fact_sources fs WHERE fs.fact_id = f.id) >= $${params.push(minReinforced)}`);
    const { rows } = await this.pool.query(
      `SELECT f.id,
              ts_rank(${FACT_TSVECTOR}, plainto_tsquery('english', $1)) AS rank
       FROM facts f
       JOIN entities subj ON subj.id = f.subject_id
       JOIN entities obj  ON obj.id  = f.object_id
       WHERE ${clauses.join(" AND ")}
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
  async history(subjectId: string, predicate?: string): Promise<FactChange[]> {
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
    // Return FactChange (recall row + retiredAt): the chain is mostly retired Facts,
    // so each link carries BOTH transaction-time stamps (learnedAt + retiredAt) —
    // the full bi-temporal story, not just the valid interval.
    return rows.map(mapFactChange);
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
   *
   * The eligibility of superseded Facts is the load-bearing fairness property: on
   * a point-in-time question, the historically-correct (now-superseded) Fact is in
   * the candidate set, so the baseline's miss is an honest ranking choice — recency
   * picks the wrong one — not structural blindness. Locked by
   * `test/eval-baseline-fairness.integration.test.ts`.
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

  /**
   * The Sources asserting each of `factIds` (origin + Reaffirmations), chronological
   * by Source ingest — the provenance detail behind `reinforcedBy`. One batched
   * query keyed by Fact id; backs recall's opt-in `include_sources`.
   */
  async citingSourcesFor(
    factIds: string[],
  ): Promise<Map<string, Array<{ id: string; label: string | null }>>> {
    const out = new Map<string, Array<{ id: string; label: string | null }>>();
    if (factIds.length === 0) return out;
    const { rows } = await this.pool.query(
      `SELECT fs.fact_id, s.id, s.label
       FROM fact_sources fs
       JOIN sources s ON s.id = fs.source_id
       WHERE fs.fact_id = ANY($1::uuid[])
       ORDER BY s.created_at ASC, s.id ASC`,
      [factIds],
    );
    for (const r of rows) {
      const factId = r.fact_id as string;
      const list = out.get(factId) ?? [];
      list.push({ id: r.id as string, label: (r.label as string | null) ?? null });
      out.set(factId, list);
    }
    return out;
  }

  /**
   * A read-only snapshot of the whole graph for the `stats` tool: Entity/Source
   * counts, Fact totals split Current vs superseded (transaction time open vs
   * closed), and a per-Predicate breakdown. Current is `expired_at IS NULL`, the
   * same definition every reader uses; superseded is the complement, so the two
   * always sum to total. Touches no write path.
   */
  async graphStats(): Promise<GraphStats> {
    const [{ rows: ent }, { rows: src }, { rows: factRows }, { rows: predRows }] = await Promise.all([
      this.pool.query("SELECT count(*)::int AS n FROM entities"),
      this.pool.query("SELECT count(*)::int AS n FROM sources"),
      this.pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE expired_at IS NULL)::int AS current
         FROM facts`,
      ),
      this.pool.query(
        `SELECT predicate,
                count(*)::int AS total,
                count(*) FILTER (WHERE expired_at IS NULL)::int AS current
         FROM facts
         GROUP BY predicate
         ORDER BY total DESC, predicate ASC`,
      ),
    ]);

    const total = (factRows[0]?.total as number) ?? 0;
    const current = (factRows[0]?.current as number) ?? 0;
    return {
      entities: (ent[0]?.n as number) ?? 0,
      sources: (src[0]?.n as number) ?? 0,
      facts: { total, current, superseded: total - current },
      predicates: predRows.map((r) => ({
        predicate: r.predicate as string,
        current: r.current as number,
        total: r.total as number,
      })),
    };
  }

  /**
   * List Entities for the `entities` tool — each with the number of Current Facts
   * touching it (subject or object), most-connected first. An optional `query`
   * filters by normalized-name substring (case-insensitive) so an agent can find
   * an Entity without already knowing its exact name. Read-only.
   */
  async listEntities(opts: { query?: string; limit?: number } = {}): Promise<EntitySummary[]> {
    const lim = clampLimit(opts.limit ?? 50);
    const q = opts.query?.trim() ? normalizeName(opts.query) : null;
    const where = q === null ? "" : "WHERE e.normalized_name ILIKE '%' || $1 || '%'";
    const params = q === null ? [] : [q];
    const { rows } = await this.pool.query(
      `SELECT e.id, e.name,
              count(f.id) FILTER (WHERE f.expired_at IS NULL)::int AS current_facts,
              array_agg(DISTINCT f.predicate) FILTER (WHERE f.expired_at IS NULL) AS predicates
       FROM entities e
       LEFT JOIN facts f ON f.subject_id = e.id OR f.object_id = e.id
       ${where}
       GROUP BY e.id, e.name
       ORDER BY current_facts DESC, e.name ASC
       LIMIT ${lim}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      currentFacts: r.current_facts as number,
      // array_agg yields NULL (not []) when no Current Fact matches the FILTER;
      // sort for a deterministic, stable order.
      predicates: ((r.predicates as string[] | null) ?? []).sort(),
    }));
  }

  /**
   * List ingested Sources for the `sources` tool — newest first, each with its
   * label, ingest time, a text preview, and how many Facts cite it. Read-only;
   * a provenance-audit complement to `stats` (aggregate) and `entities` (nodes).
   */
  async listSources(opts: { limit?: number } = {}): Promise<SourceSummary[]> {
    const lim = clampLimit(opts.limit ?? 50);
    const { rows } = await this.pool.query(
      `SELECT s.id, s.label, s.text, s.created_at,
              (SELECT count(*)::int FROM fact_sources fs WHERE fs.source_id = s.id) AS facts
       FROM sources s
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT ${lim}`,
    );
    return rows.map((r) => {
      const text = (r.text as string) ?? "";
      return {
        id: r.id as string,
        label: (r.label as string | null) ?? null,
        createdAt: r.created_at as Date,
        facts: (r.facts as number) ?? 0,
        preview: text.length > 200 ? `${text.slice(0, 200)}…` : text,
      };
    });
  }
}

import pg from "pg";
import type { Snapshot } from "./graph-model";

const DEFAULT_DATABASE_URL = "postgres://postgres:tense@localhost:5432/tense";

let pool: pg.Pool | null = null;
/** The viewer's single Postgres pool — shared by the read snapshot and the
 *  POST /api/remember ingestion route (ADR 0004). */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.TENSE_DATABASE_URL ?? DEFAULT_DATABASE_URL,
    });
  }
  return pool;
}

/**
 * Read a consistent graph snapshot: entities + all Facts (Current and
 * superseded), with `current` derived from `expired_at IS NULL` to match the
 * store's partial index. Both reads run in one READ ONLY REPEATABLE READ
 * transaction, so the viewer never observes a torn state mid-Supersession (one
 * edge already greyed while the other isn't yet solid).
 */
export async function fetchSnapshot(): Promise<Snapshot> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    // Creation order is the stable layout key (ADR slice 02): append-only, so an
    // existing Entity's on-screen position never changes when a new one appears.
    const entities = await client.query(
      "SELECT id, name FROM entities ORDER BY created_at ASC, id ASC",
    );
    const facts = await client.query(
      `SELECT f.id, f.subject_id, f.predicate, f.object_id,
              (f.expired_at IS NULL) AS current, f.valid_at, f.invalid_at, f.created_at,
              subj.name AS subject_name, obj.name AS object_name,
              (SELECT count(*)::int FROM fact_sources fs WHERE fs.fact_id = f.id) AS reinforced_by,
              (SELECT array_agg(s2.label ORDER BY s2.created_at, s2.id)
                 FROM fact_sources fs JOIN sources s2 ON s2.id = fs.source_id
                WHERE fs.fact_id = f.id) AS cited_by
       FROM facts f
       JOIN entities subj ON subj.id = f.subject_id
       JOIN entities obj  ON obj.id  = f.object_id
       ORDER BY f.created_at`,
    );
    await client.query("COMMIT");

    return {
      entities: entities.rows.map((r) => ({ id: r.id, name: r.name })),
      facts: facts.rows.map((r) => ({
        id: r.id,
        subjectId: r.subject_id,
        predicate: r.predicate,
        objectId: r.object_id,
        current: r.current,
        validAt: r.valid_at ? new Date(r.valid_at).toISOString() : null,
        invalidAt: r.invalid_at ? new Date(r.invalid_at).toISOString() : null,
        subject: r.subject_name as string,
        object: r.object_name as string,
        reinforcedBy: (r.reinforced_by as number) ?? 0,
        learnedAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
        // Source labels asserting this Fact (null label → "(unlabeled)") — the
        // provenance behind the count, for the detail panel's on-hover audit.
        citedBy: ((r.cited_by as Array<string | null> | null) ?? []).map((l) => l ?? "(unlabeled)"),
      })),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

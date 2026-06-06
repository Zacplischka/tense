import pg from "pg";
import type { Snapshot } from "./graph-model";

const DEFAULT_DATABASE_URL = "postgres://postgres:tense@localhost:5432/tense";

let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
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
    const entities = await client.query("SELECT id, name FROM entities ORDER BY name");
    const facts = await client.query(
      `SELECT id, subject_id, predicate, object_id,
              (expired_at IS NULL) AS current, valid_at, invalid_at
       FROM facts
       ORDER BY created_at`,
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
      })),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

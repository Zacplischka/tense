import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/**
 * Apply every not-yet-applied SQL file in `migrations/`, in filename order, each
 * in its own transaction, recording it in `schema_migrations`. Idempotent: safe
 * to run repeatedly. This is the one-command DB bootstrap the project stands on.
 */
export async function migrate(
  connectionString: string,
  log: (msg: string) => void = () => {},
): Promise<void> {
  const pool = new pg.Pool({ connectionString });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name       text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const { rowCount } = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [
        file,
      ]);
      if (rowCount) {
        log(`skip   ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`apply  ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

/**
 * Ensure the target database in `connectionString` exists, creating it if not by
 * connecting to the server's default `postgres` database. Lets a fresh checkout
 * (and the test harness) bootstrap without a manual `createdb`.
 */
export async function ensureDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, "");
  if (!dbName) throw new Error(`No database name in connection string: ${connectionString}`);

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!rowCount) {
      // Database identifiers can't be parameterized; dbName comes from our own
      // config/test URL, not user input. Quote to be safe regardless.
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
}

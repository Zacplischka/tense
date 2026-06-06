import pg from "pg";
import { loadConfig } from "../config.js";

/**
 * A shared pg connection pool. Callers normally use the default (driven by
 * TENSE_DATABASE_URL); tests pass an explicit connection string for an isolated
 * database.
 */
export function createPool(connectionString = loadConfig().databaseUrl): pg.Pool {
  return new pg.Pool({ connectionString });
}

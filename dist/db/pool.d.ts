import pg from "pg";
/**
 * A shared pg connection pool. Callers normally use the default (driven by
 * TENSE_DATABASE_URL); tests pass an explicit connection string for an isolated
 * database.
 */
export declare function createPool(connectionString?: string): pg.Pool;

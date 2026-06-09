/**
 * Apply every not-yet-applied SQL file in `migrations/`, in filename order, each
 * in its own transaction, recording it in `schema_migrations`. Idempotent: safe
 * to run repeatedly. This is the one-command DB bootstrap the project stands on.
 */
export declare function migrate(connectionString: string, log?: (msg: string) => void): Promise<void>;
/**
 * Ensure the target database in `connectionString` exists, creating it if not by
 * connecting to the server's default `postgres` database. Lets a fresh checkout
 * (and the test harness) bootstrap without a manual `createdb`.
 */
export declare function ensureDatabase(connectionString: string): Promise<void>;

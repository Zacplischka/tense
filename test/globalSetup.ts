import { ensureDatabase, migrate } from "../src/db/migrate.js";

/** Connection string for the isolated integration-test database. */
export const TEST_DATABASE_URL =
  process.env.TENSE_DATABASE_URL ?? "postgres://postgres:tense@localhost:5432/tense_test";

/**
 * Vitest global setup: create the test database if needed and migrate it once
 * before the suite runs, so integration tests hit a real, schema-correct
 * Postgres. Requires Postgres up (`pnpm db:up`).
 */
export default async function setup(): Promise<void> {
  await ensureDatabase(TEST_DATABASE_URL);
  await migrate(TEST_DATABASE_URL);
}

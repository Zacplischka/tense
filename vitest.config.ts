import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL = "postgres://postgres:tense@localhost:5432/tense_test";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    // Point the store/config at the isolated test database.
    env: { TENSE_DATABASE_URL: TEST_DATABASE_URL },
    // Integration tests share one Postgres; run files serially to avoid
    // cross-file TRUNCATE races.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});

import { existsSync } from "node:fs";

// Load .env so integration tests can reach OPENROUTER_API_KEY + model ids.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // ignore malformed .env
  }
}

// Never let .env point the test suite at the dev database — force the isolated
// test database regardless of what .env says.
process.env.TENSE_DATABASE_URL = "postgres://postgres:tense@localhost:5432/tense_test";

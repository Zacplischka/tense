/**
 * Load `.env` into process.env if present, using Node's native loader (no
 * dependency). Import this first from entry points (server, scripts) so config
 * picks up local settings. Tests load it via the vitest setup.
 */
import { existsSync } from "node:fs";

const ENV_FILE = new URL("../.env", import.meta.url);

if (existsSync(ENV_FILE)) {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // Malformed .env shouldn't crash startup; explicit env vars still apply.
  }
}

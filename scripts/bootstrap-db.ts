/**
 * One-command DB bootstrap: ensure the database exists, then apply migrations.
 * Run via `pnpm db:bootstrap` (or `pnpm db:setup` to also start Postgres).
 */
import { loadConfig } from "../src/config.js";
import { ensureDatabase, migrate } from "../src/db/migrate.js";

async function main(): Promise<void> {
  const { databaseUrl } = loadConfig();
  const safeUrl = databaseUrl.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
  console.log(`[tense] bootstrapping ${safeUrl}`);

  await ensureDatabase(databaseUrl);
  await migrate(databaseUrl, (msg) => console.log(`[tense] ${msg}`));

  console.log("[tense] database ready");
}

main().catch((err) => {
  console.error("[tense] bootstrap failed:", err);
  process.exit(1);
});

import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPool } from "../../../lib/snapshot";
import { createRememberDeps } from "../../../../dist/remember-deps.js";
import { remember } from "../../../../dist/pipeline.js";

// Importing the compiled pipeline (ADR 0004) needs the Node runtime; never cache.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The viewer runs from its own directory, so Next won't load the project-root
// .env. Pull OPENROUTER_API_KEY / TENSE_* from it (best-effort) so extraction has
// its credentials; explicit env vars still win.
const rootEnv = join(process.cwd(), "..", ".env");
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    // malformed .env shouldn't break the route; explicit env still applies
  }
}

// Lazily built so a missing OPENROUTER_API_KEY surfaces as a request error, not
// a boot crash, and the deps (and their pool) are reused across requests.
let deps: ReturnType<typeof createRememberDeps> | null = null;
function getDeps() {
  if (!deps) deps = createRememberDeps(getPool());
  return deps;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = (body as { text?: unknown })?.text;
  const source = (body as { source?: unknown })?.source;
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const summary = await remember(
      getDeps(),
      text,
      typeof source === "string" && source.trim() ? source : null,
    );
    return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    // Extraction precedes any write, so a failure here leaves the graph untouched.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "remember failed" },
      { status: 500 },
    );
  }
}

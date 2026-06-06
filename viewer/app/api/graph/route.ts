import { NextResponse } from "next/server";
import { fetchSnapshot } from "../../../lib/snapshot";

// Always read live from Postgres (no caching); needs the Node runtime for `pg`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const snapshot = await fetchSnapshot();
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "snapshot failed" },
      { status: 500 },
    );
  }
}

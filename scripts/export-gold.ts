/**
 * Export the per-Source extraction examples (the smoke gold set) as JSON for the
 * offline DSPy pipeline. Keeps the Python side decoupled from the TS sources.
 *
 *   pnpm tsx scripts/export-gold.ts   ->  dspy/gold.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SMOKE_GOLD } from "../eval/smoke-gold.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "dspy", "gold.json");

const examples = SMOKE_GOLD.map((s) => ({
  source: s.source,
  entities: s.expectedEntities,
  facts: s.expectedFacts.map((f) => ({
    subject: f.subject,
    predicate: f.predicate,
    object: f.object,
    valid_at: f.validAt,
  })),
}));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(examples, null, 2) + "\n");
console.log(`wrote ${examples.length} examples -> ${out}`);

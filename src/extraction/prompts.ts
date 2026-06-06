import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPredicateRegistry, type PredicateRegistry } from "../supersession/registry.js";

/**
 * Static extraction prompt assets (ADR 0003: ship static, DSPy-optimize offline).
 * Seeded from the spirit of Graphiti's extract_edges/resolve_edge prompts:
 * pull entities, then typed subject→predicate→object Facts, with valid time when
 * the text states it. Slice 14 may replace these with DSPy-compiled versions.
 */

export const EXTRACTION_SYSTEM_PROMPT = `You extract a temporal knowledge graph from text.

Return STRICT JSON (no prose, no markdown) with this exact shape:
{
  "entities": [{ "name": string }],
  "facts": [{
    "subject": string,
    "predicate": string,
    "object": string,
    "valid_at": string | null,
    "invalid_at": string | null
  }]
}

Rules:
- Entities are distinct real-world things (people, places, orgs, features). Use
  the cleanest canonical name; reuse a known entity name when the text clearly
  refers to it.
- A Fact is a directed relationship subject -> predicate -> object, where BOTH
  subject and object are entities. Do not emit a Fact for an attribute that isn't
  a relationship between two entities.
- predicate must be a lowercase hyphenated slug (e.g. "reports-to", "lives-in",
  "works-at", "knows", "contributed-to", "left"). Prefer the known predicates
  listed below when they fit.
- valid_at: an ISO-8601 date (YYYY-MM-DD) for when the fact became true in the
  world, ONLY if the text states or clearly implies it; otherwise null. Do not
  guess. Relative words like "now"/"currently" with no date => null.
- invalid_at: an ISO-8601 date for when it stopped being true, if stated;
  otherwise null.
- Output only the JSON object.`;

/**
 * A DSPy-compiled static asset (ADR 0003): optimized instructions + bootstrapped
 * few-shot demonstrations. Shipped as JSON; no Python at runtime.
 */
export interface CompiledExtraction {
  instructions: string;
  demos: Array<{ source: string; output: unknown }>;
  meta?: Record<string, unknown>;
}

const COMPILED_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dspy",
  "compiled",
  "extraction.json",
);

let cached: CompiledExtraction | null | undefined;

/** Load the DSPy-compiled asset if present; null when none has been exported. */
export function loadCompiledExtraction(): CompiledExtraction | null {
  if (cached !== undefined) return cached;
  try {
    cached = existsSync(COMPILED_PATH)
      ? (JSON.parse(readFileSync(COMPILED_PATH, "utf8")) as CompiledExtraction)
      : null;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Resolve the system prompt + few-shot block from a compiled asset, falling back
 * to the hand-tuned baseline when none exists. Pure (asset injected) so it is
 * unit-testable — this is the seam DSPy's offline output plugs into.
 */
export function resolveExtractionPrompt(compiled: CompiledExtraction | null): {
  system: string;
  fewShot: string;
} {
  if (!compiled) return { system: EXTRACTION_SYSTEM_PROMPT, fewShot: "" };
  const fewShot = compiled.demos.length
    ? `Examples:\n${compiled.demos
        .map((d) => `Text: ${d.source}\nJSON: ${JSON.stringify(d.output)}`)
        .join("\n\n")}\n\n`
    : "";
  return { system: compiled.instructions || EXTRACTION_SYSTEM_PROMPT, fewShot };
}

export function buildExtractionUserPrompt(
  sourceText: string,
  knownEntities: string[] = [],
  registry: PredicateRegistry = defaultPredicateRegistry(),
): string {
  const predicates = registry
    .entries()
    .map(([p, card]) => `  - ${p} (${card}-valued)`)
    .join("\n");

  const known =
    knownEntities.length > 0
      ? `Known entities (reuse these names when the text refers to them):\n${knownEntities
          .map((e) => `  - ${e}`)
          .join("\n")}\n\n`
      : "";

  return `Known predicates:\n${predicates}\n\n${known}Extract entities and facts from this text:\n"""\n${sourceText}\n"""`;
}

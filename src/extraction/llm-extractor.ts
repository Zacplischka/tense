import { z } from "zod";
import type { ProviderClient } from "../provider/types.js";
import { defaultPredicateRegistry, type PredicateRegistry } from "../supersession/registry.js";
import {
  buildExtractionUserPrompt,
  loadCompiledExtraction,
  resolveExtractionPrompt,
} from "./prompts.js";
import { ExtractionError, type ExtractionResult, type Extractor } from "./types.js";

const ResponseSchema = z.object({
  entities: z.array(z.object({ name: z.string().min(1) })).default([]),
  facts: z
    .array(
      z.object({
        subject: z.string().min(1),
        predicate: z.string().min(1),
        object: z.string().min(1),
        valid_at: z.string().nullable().optional(),
        invalid_at: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export interface LlmExtractorOptions {
  model?: string;
  registry?: PredicateRegistry;
}

/**
 * LLM-backed extractor: structured-output completion -> schema-validated graph.
 * Malformed or non-JSON output raises {@link ExtractionError} so the caller can
 * surface a clean error without crashing (slice 07 keeps the MCP server alive).
 */
export class LlmExtractor implements Extractor {
  private readonly registry: PredicateRegistry;

  constructor(
    private readonly provider: ProviderClient,
    private readonly opts: LlmExtractorOptions = {},
  ) {
    this.registry = opts.registry ?? defaultPredicateRegistry();
  }

  async extract(sourceText: string, knownEntities: string[] = []): Promise<ExtractionResult> {
    // Use the DSPy-compiled prompt if one has been exported; else the baseline.
    const { system, fewShot } = resolveExtractionPrompt(loadCompiledExtraction());
    const { text } = await this.provider.complete({
      system,
      prompt: fewShot + buildExtractionUserPrompt(sourceText, knownEntities, this.registry),
      json: true,
      temperature: 0,
      model: this.opts.model,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFences(text));
    } catch {
      throw new ExtractionError(`Extraction returned non-JSON output: ${text.slice(0, 200)}`);
    }

    const result = ResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new ExtractionError(`Extraction output failed validation: ${result.error.message}`);
    }

    return {
      entities: result.data.entities.map((e) => ({ name: e.name.trim() })),
      facts: result.data.facts.map((f) => ({
        subject: f.subject.trim(),
        predicate: normalizePredicate(f.predicate),
        object: f.object.trim(),
        validAt: parseDate(f.valid_at),
        invalidAt: parseDate(f.invalid_at),
      })),
    };
  }
}

/** Canonicalize a predicate to a lowercase hyphenated slug. */
function normalizePredicate(predicate: string): string {
  return predicate.trim().toLowerCase().replace(/\s+/g, "-");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Strip a ```json … ``` fence if a model wraps its JSON despite json mode. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? (fenced[1] ?? trimmed) : trimmed;
}

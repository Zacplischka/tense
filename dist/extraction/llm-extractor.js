import { z } from "zod";
import { defaultPredicateRegistry } from "../supersession/registry.js";
import { buildExtractionUserPrompt, loadCompiledExtraction, resolveExtractionPrompt, } from "./prompts.js";
import { ExtractionError } from "./types.js";
const ResponseSchema = z.object({
    entities: z.array(z.object({ name: z.string().min(1) })).default([]),
    facts: z
        .array(z.object({
        subject: z.string().min(1),
        predicate: z.string().min(1),
        object: z.string().min(1),
        valid_at: z.string().nullable().optional(),
        invalid_at: z.string().nullable().optional(),
    }))
        .default([]),
});
/**
 * LLM-backed extractor: structured-output completion -> schema-validated graph.
 * Malformed or non-JSON output raises {@link ExtractionError} so the caller can
 * surface a clean error without crashing (slice 07 keeps the MCP server alive).
 */
export class LlmExtractor {
    provider;
    opts;
    registry;
    constructor(provider, opts = {}) {
        this.provider = provider;
        this.opts = opts;
        this.registry = opts.registry ?? defaultPredicateRegistry();
    }
    async extract(sourceText, knownEntities = []) {
        // Use the DSPy-compiled prompt if one has been exported; else the baseline.
        const { system, fewShot } = resolveExtractionPrompt(loadCompiledExtraction());
        const { text } = await this.provider.complete({
            system,
            prompt: fewShot + buildExtractionUserPrompt(sourceText, knownEntities, this.registry),
            json: true,
            temperature: 0,
            model: this.opts.model,
        });
        let parsed;
        try {
            parsed = JSON.parse(stripCodeFences(text));
        }
        catch {
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
function normalizePredicate(predicate) {
    return predicate.trim().toLowerCase().replace(/\s+/g, "-");
}
function parseDate(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
/** Strip a ```json … ``` fence if a model wraps its JSON despite json mode. */
function stripCodeFences(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return fenced ? (fenced[1] ?? trimmed) : trimmed;
}
//# sourceMappingURL=llm-extractor.js.map
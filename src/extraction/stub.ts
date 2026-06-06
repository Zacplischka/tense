/**
 * Deterministic, LLM-free stub extractor for the walking skeleton (slice 01).
 *
 * It recognizes a handful of demo predicates with a simple regex over each
 * sentence, so the full ingest pipeline exists and is testable before any model
 * is wired in. The real LLM extractor (structured output, entity resolution,
 * predicate typing) lands in slice 05 behind the same `Extractor` interface.
 *
 * Valid time: most prose ("Zach now reports to Bob") carries no extractable
 * date, so `validAt` is null by default — deliberately exercising the degenerate
 * valid_at path. An explicit leading "[YYYY-MM-DD]" sets it when present.
 */

export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  validAt: Date | null;
}

export interface Extractor {
  extract(text: string): ExtractedFact[];
}

/** Surface phrasings mapped to canonical Predicate slugs (see CONTEXT.md). */
const PREDICATE_PATTERNS: ReadonlyArray<{ re: RegExp; predicate: string }> = [
  { re: /\breports?\s+to\b|\breported\s+to\b/i, predicate: "reports-to" },
  { re: /\blives?\s+in\b|\blived\s+in\b/i, predicate: "lives-in" },
  { re: /\bcontributed\s+to\b/i, predicate: "contributed-to" },
  { re: /\bknows\b|\bknew\b/i, predicate: "knows" },
];

const NAME = "[A-Z][\\w&'-]*(?:\\s+[A-Z][\\w&'-]*)*";

/** Trim surrounding whitespace and any trailing sentence punctuation. */
function cleanName(raw: string): string {
  return raw.trim().replace(/[.,;:!?]+$/, "");
}

function parseLeadingDate(sentence: string): { rest: string; validAt: Date | null } {
  const match = sentence.match(/^\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/s);
  if (!match) return { rest: sentence, validAt: null };
  const validAt = new Date(`${match[1]}T00:00:00Z`);
  return { rest: match[2] ?? "", validAt: Number.isNaN(validAt.getTime()) ? null : validAt };
}

export class StubExtractor implements Extractor {
  extract(text: string): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    for (const rawSentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      const { rest, validAt } = parseLeadingDate(rawSentence);
      if (!rest.trim()) continue;

      for (const { re, predicate } of PREDICATE_PATTERNS) {
        const verb = rest.match(re);
        if (!verb) continue;

        const subjectMatch = rest.slice(0, verb.index).match(new RegExp(`(${NAME})\\s*$`));
        const objectMatch = rest.slice((verb.index ?? 0) + verb[0].length).match(
          new RegExp(`^\\s*(${NAME})`),
        );
        if (!subjectMatch?.[1] || !objectMatch?.[1]) continue;

        facts.push({
          subject: cleanName(subjectMatch[1]),
          predicate,
          object: cleanName(objectMatch[1]),
          validAt,
        });
        break; // one Fact per sentence is enough for the skeleton
      }
    }

    return facts;
  }
}

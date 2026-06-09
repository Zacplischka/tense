/**
 * Deterministic, LLM-free extractor implementing the {@link Extractor} interface.
 *
 * It recognizes a handful of demo predicates with a simple regex over each
 * sentence, so the ingest pipeline is testable without a model. The real LLM
 * extractor (slice 05) implements the same interface; tests use this as a
 * replayable double.
 *
 * Valid time: most prose ("Zach now reports to Bob") carries no extractable
 * date, so `validAt` is null by default — deliberately exercising the degenerate
 * valid_at path. An explicit leading "[YYYY-MM-DD]" sets it when present.
 */
/** Surface phrasings mapped to canonical Predicate slugs (see CONTEXT.md). */
const PREDICATE_PATTERNS = [
    { re: /\breports?\s+to\b|\breported\s+to\b/i, predicate: "reports-to" },
    { re: /\blives?\s+in\b|\blived\s+in\b/i, predicate: "lives-in" },
    { re: /\bcontributed\s+to\b/i, predicate: "contributed-to" },
    { re: /\bknows\b|\bknew\b/i, predicate: "knows" },
];
const NAME = "[A-Z][\\w&'-]*(?:\\s+[A-Z][\\w&'-]*)*";
/** Trim surrounding whitespace and any trailing sentence punctuation. */
function cleanName(raw) {
    return raw.trim().replace(/[.,;:!?]+$/, "");
}
function parseLeadingDate(sentence) {
    const match = sentence.match(/^\s*\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/s);
    if (!match)
        return { rest: sentence, validAt: null };
    const validAt = new Date(`${match[1]}T00:00:00Z`);
    return { rest: match[2] ?? "", validAt: Number.isNaN(validAt.getTime()) ? null : validAt };
}
export class StubExtractor {
    async extract(text) {
        const facts = [];
        for (const rawSentence of text.split(/(?<=[.!?])\s+|\n+/)) {
            const { rest, validAt } = parseLeadingDate(rawSentence);
            if (!rest.trim())
                continue;
            for (const { re, predicate } of PREDICATE_PATTERNS) {
                const verb = rest.match(re);
                if (!verb)
                    continue;
                const subjectMatch = rest.slice(0, verb.index).match(new RegExp(`(${NAME})\\s*$`));
                const objectMatch = rest
                    .slice((verb.index ?? 0) + verb[0].length)
                    .match(new RegExp(`^\\s*(${NAME})`));
                if (!subjectMatch?.[1] || !objectMatch?.[1])
                    continue;
                facts.push({
                    subject: cleanName(subjectMatch[1]),
                    predicate,
                    object: cleanName(objectMatch[1]),
                    validAt,
                    invalidAt: null,
                });
                break; // one Fact per sentence is enough for the skeleton
            }
        }
        const entityNames = new Set();
        for (const f of facts) {
            entityNames.add(f.subject);
            entityNames.add(f.object);
        }
        return { entities: [...entityNames].map((name) => ({ name })), facts };
    }
}
//# sourceMappingURL=stub.js.map
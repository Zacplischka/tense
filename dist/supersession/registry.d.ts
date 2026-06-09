/**
 * Predicate cardinality registry (ADR 0002).
 *
 * Cardinality is what decides whether a new Fact supersedes a prior one:
 *   single — a subject has at most one Current Fact on this Predicate
 *            (reports-to, lives-in); a new value closes the prior one.
 *   multi  — a subject may hold many (knows, contributed-to); never superseded
 *            by cardinality.
 *
 * Unknown Predicates default to multi-valued — the fail-safe: the system never
 * wrongly closes history for a relation it hasn't been told is single-valued.
 */
export type Cardinality = "single" | "multi";
export declare class PredicateRegistry {
    private readonly map;
    constructor(entries?: Record<string, Cardinality>);
    cardinalityOf(predicate: string): Cardinality;
    /** Known (predicate, cardinality) pairs — e.g. to guide the extractor. */
    entries(): Array<[string, Cardinality]>;
}
/** Registry seeded with the demo Predicates. */
export declare function defaultPredicateRegistry(): PredicateRegistry;

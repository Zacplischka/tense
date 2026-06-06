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

export class PredicateRegistry {
  private readonly map: ReadonlyMap<string, Cardinality>;

  constructor(entries: Record<string, Cardinality> = {}) {
    this.map = new Map(Object.entries(entries));
  }

  cardinalityOf(predicate: string): Cardinality {
    return this.map.get(predicate) ?? "multi";
  }

  /** Known (predicate, cardinality) pairs — e.g. to guide the extractor. */
  entries(): Array<[string, Cardinality]> {
    return [...this.map.entries()];
  }
}

/** Registry seeded with the demo Predicates. */
export function defaultPredicateRegistry(): PredicateRegistry {
  return new PredicateRegistry({
    "reports-to": "single",
    "lives-in": "single",
    "knows": "multi",
    "contributed-to": "multi",
  });
}

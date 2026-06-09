export class PredicateRegistry {
    map;
    constructor(entries = {}) {
        this.map = new Map(Object.entries(entries));
    }
    cardinalityOf(predicate) {
        return this.map.get(predicate) ?? "multi";
    }
    /** Known (predicate, cardinality) pairs — e.g. to guide the extractor. */
    entries() {
        return [...this.map.entries()];
    }
}
/** Registry seeded with the demo Predicates. */
export function defaultPredicateRegistry() {
    return new PredicateRegistry({
        "reports-to": "single",
        "lives-in": "single",
        "knows": "multi",
        "contributed-to": "multi",
    });
}
//# sourceMappingURL=registry.js.map
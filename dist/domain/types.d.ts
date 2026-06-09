/**
 * Core domain types. Names follow CONTEXT.md exactly — Fact, Entity, Predicate,
 * Source — and the bi-temporal split (valid time vs transaction time) from
 * ADR 0002. Deviating from this vocabulary is the project's signature mistake.
 */
/** A chunk of ingested text; every Fact traces back to one for provenance. */
export interface Source {
    id: string;
    /** Optional human label (e.g. "org-chart-2024-q1.md"). */
    label: string | null;
    text: string;
    createdAt: Date;
}
/** A distinct thing Facts connect. Immutable identifying properties only. */
export interface Entity {
    id: string;
    name: string;
    /** Lower/trimmed form backing exact-match (and later fuzzy) resolution. */
    normalizedName: string;
    createdAt: Date;
}
/**
 * A directed, typed relationship subject -> predicate -> object. The only thing
 * that can be superseded. Bi-temporal: valid time is when it was true in the
 * world; transaction time is when the system held it as Current.
 */
export interface Fact {
    id: string;
    subjectId: string;
    predicate: string;
    objectId: string;
    sourceId: string;
    /** Valid time (world). Nullable — see the degenerate valid_at policy. */
    validAt: Date | null;
    invalidAt: Date | null;
    /** Transaction time (system, wall-clock). */
    createdAt: Date;
    /** Null iff the Fact is Current. */
    expiredAt: Date | null;
}

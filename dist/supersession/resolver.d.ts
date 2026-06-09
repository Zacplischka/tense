import type { PredicateRegistry } from "./registry.js";
/** Which way a Supersession resolved (for explainability and the demo narrative). */
export type SupersessionDirection = "no-supersession" | "new-supersedes-existing" | "existing-supersedes-new";
/** An existing Current Fact that could be superseded by the incoming one. */
export interface CandidateFact {
    id: string;
    /** Valid time (world); null when it couldn't be extracted. */
    validAt: Date | null;
    /** Transaction time the system first held it (wall-clock). */
    createdAt: Date;
}
export interface ResolverInput {
    /** Only the fields the temporal decision needs from the incoming Fact. */
    newFact: {
        predicate: string;
        validAt: Date | null;
    };
    /** Current Facts for the same (subject, predicate). */
    candidateFacts: CandidateFact[];
    registry: PredicateRegistry;
    /** Transaction time of this ingest (injected so the resolver stays pure). */
    now: Date;
}
/** Instruction to close an existing Fact. */
export interface FactClosePlan {
    factId: string;
    /** Valid-time end. */
    invalidAt: Date | null;
    /** Transaction-time end (drives Current). */
    expiredAt: Date;
}
/** How the incoming Fact is born. */
export interface NewFactTemporal {
    validAt: Date | null;
    invalidAt: Date | null;
    /** Null = born Current; set = born already-expired (out-of-order ingestion). */
    expiredAt: Date | null;
}
export interface SupersessionPlan {
    direction: SupersessionDirection;
    toClose: FactClosePlan[];
    newFact: NewFactTemporal;
}
/**
 * Pure, deterministic supersession resolver — the cardinality path (ADR 0002).
 * Decides, for an incoming Fact and the existing Current Facts on the same
 * (subject, predicate), which Fact closes and with what bi-temporal intervals.
 * Touches no database; the caller applies the plan via the store's atomic
 * supersession boundary.
 */
export declare function resolveSupersession(input: ResolverInput): SupersessionPlan;
/**
 * The valid-time direction rule (ADR 0002), shared by BOTH supersession paths —
 * cardinality (above) and LLM-judged contradiction (slice 12) — so direction is
 * decided in exactly one place. Is the existing Fact newer (in valid time) than
 * the incoming one? True only when both valid times are known and the existing
 * one is strictly later. A null valid_at on either side, or a tie, defers to the
 * transaction-time fallback (the incoming Fact, ingested now, is the live truth).
 */
export declare function existingIsNewer(existing: CandidateFact, newValidAt: Date | null): boolean;
/**
 * The close intervals when a Fact is retired by a newer one: valid-time end is
 * the newer Fact's valid_at when known, else the transaction time as an explicit,
 * documented fallback (never silently reused as if it were valid time);
 * transaction-time end is now.
 */
export declare function closeIntervals(newerValidAt: Date | null, now: Date): {
    invalidAt: Date | null;
    expiredAt: Date;
};

import type { PredicateRegistry } from "./registry.js";

/** Which way a Supersession resolved (for explainability and the demo narrative). */
export type SupersessionDirection =
  | "no-supersession"
  | "new-supersedes-existing"
  | "existing-supersedes-new";

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
  newFact: { predicate: string; validAt: Date | null };
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
export function resolveSupersession(input: ResolverInput): SupersessionPlan {
  const { newFact, candidateFacts, registry, now } = input;

  const bornCurrent: NewFactTemporal = {
    validAt: newFact.validAt,
    invalidAt: null,
    expiredAt: null,
  };

  // Multi-valued (and unknown -> multi, fail-safe): cardinality never supersedes.
  if (registry.cardinalityOf(newFact.predicate) !== "single") {
    return { direction: "no-supersession", toClose: [], newFact: bornCurrent };
  }

  if (candidateFacts.length === 0) {
    return { direction: "no-supersession", toClose: [], newFact: bornCurrent };
  }

  // Single-valued. Direction rule (ADR 0002): the Fact with the earlier valid_at
  // closes. The incoming Fact's transaction time is `now`, later than any
  // existing createdAt, so when valid time can't decide (null) or ties, the
  // transaction-time fallback makes the incoming Fact the live truth.

  // An existing Fact outranks the incoming one only when valid time proves it is
  // newer — i.e. out-of-order ingestion.
  const newerExisting = candidateFacts
    .filter((c) => existingIsNewer(c, newFact.validAt))
    .sort((a, b) => a.validAt!.getTime() - b.validAt!.getTime());

  if (newerExisting.length > 0) {
    // The incoming Fact is actually older than an existing one -> born expired.
    // Its valid interval ends when the next (earliest-newer) truth began.
    const nextTruth = newerExisting[0]!;
    return {
      direction: "existing-supersedes-new",
      toClose: [],
      newFact: {
        validAt: newFact.validAt,
        invalidAt: nextTruth.validAt,
        expiredAt: now,
      },
    };
  }

  // The incoming Fact is the live truth -> close every existing Current Fact.
  const toClose: FactClosePlan[] = candidateFacts.map((c) => ({
    factId: c.id,
    // Valid-time end = the incoming valid_at when known; else the transaction
    // time as an explicit, documented fallback (never silently reused as if it
    // were valid time).
    invalidAt: newFact.validAt ?? now,
    expiredAt: now,
  }));

  return { direction: "new-supersedes-existing", toClose, newFact: bornCurrent };
}

/**
 * Is the existing Fact newer (in valid time) than the incoming one? True only
 * when both valid times are known and the existing one is strictly later. A null
 * valid_at on either side, or a tie, defers to the transaction-time fallback —
 * under which the incoming Fact (ingested now) is the live truth — so this
 * returns false.
 */
function existingIsNewer(existing: CandidateFact, newValidAt: Date | null): boolean {
  if (existing.validAt === null || newValidAt === null) return false;
  return existing.validAt.getTime() > newValidAt.getTime();
}

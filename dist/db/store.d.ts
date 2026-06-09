import type pg from "pg";
import type { Entity, Fact, Source } from "../domain/types.js";
/** Fields needed to insert a new Fact. Timestamps default at the DB. */
export interface NewFact {
    subjectId: string;
    predicate: string;
    objectId: string;
    sourceId: string;
    validAt: Date | null;
    invalidAt: Date | null;
    /**
     * Transaction-time end at insert. Normally null (Fact is born Current); set to
     * a timestamp only for a "born-expired" Fact — one ingested out of order whose
     * valid time predates an existing Fact (slice 03's direction rule).
     */
    expiredAt: Date | null;
}
/**
 * Instruction to close one existing Fact during a Supersession. The resolver
 * (slice 03) decides the values; the store only applies them. Keeping both ends
 * explicit prevents conflating valid and transaction time:
 *   invalidAt -> valid-time end (when the Fact stopped being true in the world)
 *   expiredAt -> transaction-time end (when the system retired it; drives Current)
 */
export interface FactClose {
    factId: string;
    invalidAt: Date | null;
    expiredAt: Date;
}
/**
 * A high-level snapshot of the graph for introspection (the `stats` tool): how
 * many Entities/Sources exist, how many Facts are Current vs superseded, and a
 * per-Predicate breakdown. Read-only — never touches the supersession path.
 */
export interface GraphStats {
    entities: number;
    sources: number;
    facts: {
        total: number;
        current: number;
        superseded: number;
    };
    /** Per-Predicate counts, ordered by total descending then predicate ascending. */
    predicates: Array<{
        predicate: string;
        current: number;
        total: number;
    }>;
}
/**
 * One Entity in the `entities` listing: its name plus how many Current Facts
 * touch it (as subject OR object) — a "how connected is this node" degree that
 * lets an agent browse the graph by Entity rather than by relevance query.
 */
export interface EntitySummary {
    id: string;
    name: string;
    /** Count of Current Facts where this Entity is the subject or the object. */
    currentFacts: number;
    /**
     * Distinct Predicates of those Current Facts (sorted) — the Entity's relationship
     * "shape", so a caller browsing can see what KINDS of Facts touch it (e.g.
     * reports-to, knows) and pick its next move (history-by-predicate / recall).
     */
    predicates: string[];
}
/**
 * One ingested Source in the `sources` listing — a provenance-audit view: its
 * label, when it was ingested, how many Facts cite it (origin or Reaffirmation),
 * and a short text preview. Full Source text comes back via `recall` (each Fact's
 * `source.text`); this keeps the listing economical.
 */
export interface SourceSummary {
    id: string;
    label: string | null;
    createdAt: Date;
    /** Number of Facts that cite this Source (origin or Reaffirmation, ADR 0005). */
    facts: number;
    /** First ~200 chars of the Source text (truncated with … when longer). */
    preview: string;
}
/** A Fact resolved for reading: entity names + Source text inlined. */
export interface RecalledFact {
    id: string;
    subject: string;
    predicate: string;
    object: string;
    validAt: Date | null;
    invalidAt: Date | null;
    current: boolean;
    /**
     * Transaction time: when the system first learned this Fact (created_at) — the
     * other bi-temporal axis from `validAt`/`invalidAt` (when it was true in the
     * world). `current` says IF the Fact has been retired; `learnedAt` says WHEN it
     * entered memory, so a caller can tell "true since 2020 but only learned last
     * week" apart from a long-held belief.
     */
    learnedAt: Date;
    /**
     * The origin Source (first to assert this Fact). `text` is the full ingested
     * chunk; it is omitted when recall is called with `include_source_text: false`
     * (a token-lean mode for long Sources — re-fetch full text via the `sources`
     * tool or a default recall). Always present on `history`/`changes`.
     */
    source: {
        id: string;
        label: string | null;
        text?: string;
    };
    /**
     * How many distinct Sources assert this Fact (origin + Reaffirmations, ADR
     * 0005) — a provenance-strength signal so a reader can weigh a multiply-
     * confirmed Fact above a single mention. Always ≥1 for pipeline-ingested Facts.
     */
    reinforcedBy: number;
    /**
     * The Sources that assert this Fact (origin + Reaffirmations, chronological) —
     * the provenance behind `reinforcedBy` (`citedBy.length === reinforcedBy`). Only
     * populated on opt-in (recall's `include_sources`); omitted by default so the
     * common path stays lean. Lets a caller audit WHICH Sources back a claim.
     */
    citedBy?: Array<{
        id: string;
        label: string | null;
    }>;
}
/**
 * A Fact whose **transaction time** changed within a window — the `changes` feed.
 * Extends {@link RecalledFact} (which already carries `learnedAt`) with the
 * retirement stamp, so a caller can tell a newly learned Fact from one that was
 * just superseded. Distinct from valid-time recall.
 */
export interface FactChange extends RecalledFact {
    /** Transaction time: when the system retired it (expired_at); null = still Current. */
    retiredAt: Date | null;
}
/** Normalized form used for exact entity matching (slice 06 deepens this). */
export declare function normalizeName(name: string): string;
/** Render a number[] as a pgvector literal: [0.1,0.2,...]. */
export declare function formatVector(embedding: number[]): string;
/**
 * Clamp an externally-supplied LIMIT to a safe integer in [1, 200]. The result
 * is string-interpolated into `LIMIT ${lim}` (Postgres rejects a parameterized
 * LIMIT in some positions), so this is the guard that keeps a caller-supplied
 * limit — NaN, Infinity, a float, a negative, or an absurd value — from ever
 * reaching SQL as anything but a small positive integer. Always returns an
 * integer: floor first, then 0/NaN fall to 1, negatives clamp up to 1, and
 * anything over 200 (incl. Infinity) clamps down to 200.
 */
export declare function clampLimit(limit: number): number;
/**
 * Postgres persistence for the temporal graph. Owns the mechanics of storage and
 * the atomic Supersession boundary — but holds no supersession *policy* (which
 * Fact closes, how direction is decided): that lives in the resolver (slice 03),
 * which calls `supersedeAndInsert` with values it computed.
 */
export declare class TemporalGraphStore {
    private readonly pool;
    constructor(pool: pg.Pool);
    insertSource(text: string, label?: string | null): Promise<Source>;
    /**
     * Exact-match-or-create by normalized name. Real entity resolution (fuzzy
     * matching, short-name guards) is slice 06; this is the seed it deepens.
     */
    upsertEntity(name: string): Promise<Entity>;
    insertFact(fact: NewFact): Promise<Fact>;
    /** All Current Facts for a subject (any Predicate) with object names — the
     * contradiction path's candidate set. */
    currentFactsForSubject(subjectId: string): Promise<Array<{
        id: string;
        predicate: string;
        object: string;
        validAt: Date | null;
        createdAt: Date;
    }>>;
    /**
     * Close (expire) the given Facts on an already-open transaction client — the
     * shared mechanism behind BOTH supersession paths: cardinality
     * ({@link supersedeAndInsert}) and contradiction ({@link expireFacts}). The
     * `expired_at IS NULL` guard makes each close idempotent — re-closing an
     * already-closed Fact simply returns nothing for it. Runs on the caller's
     * client so it joins the caller's BEGIN/COMMIT; it does not manage the
     * transaction itself.
     */
    private closeFactsTx;
    /** Atomically close (expire) a set of Facts — used by the contradiction path. */
    expireFacts(closes: FactClose[]): Promise<Fact[]>;
    /** Current Facts for a (subject, predicate) — the supersession candidates. */
    currentFactsFor(subjectId: string, predicate: string): Promise<Fact[]>;
    /**
     * The atomic Supersession boundary: close zero or more existing Facts and
     * insert the new one in a single transaction, so no reader (recall, viewer)
     * ever observes a torn state. Closed Facts are expired, never deleted.
     */
    supersedeAndInsert(closes: FactClose[], newFact: NewFact): Promise<{
        closed: Fact[];
        inserted: Fact;
    }>;
    /** Store a Fact's embedding (pgvector). Best-effort; never blocks the write. */
    setFactEmbedding(factId: string, embedding: number[]): Promise<void>;
    /** Whether a Fact has an embedding stored (for tests/diagnostics). */
    hasEmbedding(factId: string): Promise<boolean>;
    /**
     * Record that a Source asserted a Fact (Reaffirmation, ADR 0005). Idempotent:
     * re-linking the same (fact, source) pair is a no-op. Called for the origin
     * Source when a Fact is first created and for every later Source that re-states
     * an already-Current Fact.
     */
    addFactSource(factId: string, sourceId: string): Promise<void>;
    /** How many distinct Sources have asserted a Fact ("reinforced N times"). */
    countFactSources(factId: string): Promise<number>;
    getEntity(id: string): Promise<Entity | null>;
    /** Entity names (capped) to hint extraction toward reusing existing Entities. */
    listEntityNames(limit?: number): Promise<string[]>;
    getFact(id: string): Promise<Fact | null>;
    /**
     * The transaction-time change feed (the `changes` tool): Facts the system
     * **learned** (`created_at >= since`) or **retired** (`expired_at >= since`)
     * since an instant, most-recent change first. This is the other half of the
     * bi-temporal model — *when the system knew*, distinct from valid-time recall
     * (*when it was true*) — and lets an agent sync incrementally ("what changed in
     * my memory since I last checked?"). A Fact created and superseded in the same
     * window appears once, with both `learnedAt` and `retiredAt` set.
     */
    changesSince(since: Date, limit?: number): Promise<FactChange[]>;
    /**
     * Browse temporally-filtered Facts (no relevance ranking) — used for an empty
     * query. `asOf` null returns Current Facts (`expired_at IS NULL`); a date
     * returns Facts valid at that instant (`valid_at <= T AND (invalid_at IS NULL
     * OR invalid_at > T)`), per ADR 0002's point-in-time formula.
     */
    recallByTemporal(asOf: Date | null, limit?: number, predicate?: string | null, minReinforced?: number | null): Promise<RecalledFact[]>;
    /** Rank Fact ids by semantic similarity to a query embedding, temporally filtered. */
    rankBySemantic(queryEmbedding: number[], asOf: Date | null, limit?: number, predicate?: string | null, minReinforced?: number | null): Promise<string[]>;
    /** Rank Fact ids by Postgres full-text relevance, temporally filtered. */
    rankByKeyword(query: string, asOf: Date | null, limit?: number, predicate?: string | null, minReinforced?: number | null): Promise<string[]>;
    /**
     * The full Supersession chain for a subject (all Facts, Current + superseded),
     * optionally narrowed to one Predicate. Ordered chronologically by valid time,
     * falling back to transaction time when valid_at is null, with transaction time
     * as the tiebreak — so a closed Fact precedes the Current one that replaced it.
     */
    history(subjectId: string, predicate?: string): Promise<FactChange[]>;
    /** All Facts (Current + superseded), with names + Source — for the eval harness. */
    allFacts(): Promise<RecalledFact[]>;
    /**
     * Top-k Facts by cosine similarity to a query embedding over ALL Facts — NO
     * temporal filter. This is the fair vector baseline's retrieval (slice 13): it
     * has no bi-temporal model, so superseded Facts are eligible and it must rely
     * on a recency tiebreak.
     *
     * The eligibility of superseded Facts is the load-bearing fairness property: on
     * a point-in-time question, the historically-correct (now-superseded) Fact is in
     * the candidate set, so the baseline's miss is an honest ranking choice — recency
     * picks the wrong one — not structural blindness. Locked by
     * `test/eval-baseline-fairness.integration.test.ts`.
     */
    baselineCandidates(queryEmbedding: number[], k?: number): Promise<Array<{
        object: string;
        validAt: Date | null;
        createdAt: Date;
    }>>;
    /** Load full RecalledFact details for ids (caller preserves the fused order). */
    loadRecalledByIds(ids: string[]): Promise<Map<string, RecalledFact>>;
    /**
     * The Sources asserting each of `factIds` (origin + Reaffirmations), chronological
     * by Source ingest — the provenance detail behind `reinforcedBy`. One batched
     * query keyed by Fact id; backs recall's opt-in `include_sources`.
     */
    citingSourcesFor(factIds: string[]): Promise<Map<string, Array<{
        id: string;
        label: string | null;
    }>>>;
    /**
     * A read-only snapshot of the whole graph for the `stats` tool: Entity/Source
     * counts, Fact totals split Current vs superseded (transaction time open vs
     * closed), and a per-Predicate breakdown. Current is `expired_at IS NULL`, the
     * same definition every reader uses; superseded is the complement, so the two
     * always sum to total. Touches no write path.
     */
    graphStats(): Promise<GraphStats>;
    /**
     * List Entities for the `entities` tool — each with the number of Current Facts
     * touching it (subject or object), most-connected first. An optional `query`
     * filters by normalized-name substring (case-insensitive) so an agent can find
     * an Entity without already knowing its exact name. Read-only.
     */
    listEntities(opts?: {
        query?: string;
        limit?: number;
    }): Promise<EntitySummary[]>;
    /**
     * List ingested Sources for the `sources` tool — newest first, each with its
     * label, ingest time, a text preview, and how many Facts cite it. Read-only;
     * a provenance-audit complement to `stats` (aggregate) and `entities` (nodes).
     */
    listSources(opts?: {
        limit?: number;
    }): Promise<SourceSummary[]>;
}

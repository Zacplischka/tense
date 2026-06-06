/**
 * Pure mapping from a graph snapshot to graph data for the renderer. No DB, no
 * React, so it is unit-testable — and it is the one place the viewer decides what
 * counts as Current. It trusts the snapshot's `current` flag (which the query
 * derives from `expired_at IS NULL`, matching the store's partial index) and
 * NEVER recomputes "current" from `invalid_at` — valid time and transaction time
 * are distinct. Layout (positions) is owned by the force-graph library, not here.
 */

export interface SnapshotEntity {
  id: string;
  name: string;
}

export interface SnapshotFact {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  /** expired_at IS NULL — the single definition of Current. */
  current: boolean;
  validAt: string | null;
  invalidAt: string | null;
  /** Subject/object display names — optional so pure-mapping tests stay terse. */
  subject?: string;
  object?: string;
  /** Distinct Sources asserting this Fact (origin + Reaffirmations, ADR 0005). */
  reinforcedBy?: number;
}

export interface Snapshot {
  entities: SnapshotEntity[];
  facts: SnapshotFact[];
}

/** A node for the force-graph (the library adds x/y/vx/vy at runtime). */
export interface GraphNodeData {
  id: string;
  name: string;
}

/** A directed link for the force-graph. */
export interface GraphLinkData {
  id: string;
  source: string;
  target: string;
  predicate: string;
  /** Solid + arrowed when true; dashed/greyed when false. */
  current: boolean;
}

export interface GraphData {
  nodes: GraphNodeData[];
  links: GraphLinkData[];
}

/** Map a snapshot to force-graph data, dropping Facts whose endpoints are absent. */
export function toGraphData(snapshot: Snapshot): GraphData {
  const ids = new Set(snapshot.entities.map((e) => e.id));
  const nodes: GraphNodeData[] = snapshot.entities.map((e) => ({ id: e.id, name: e.name }));
  const links: GraphLinkData[] = [];
  for (const f of snapshot.facts) {
    if (!ids.has(f.subjectId) || !ids.has(f.objectId)) continue; // orphan guard
    links.push({
      id: f.id,
      source: f.subjectId,
      target: f.objectId,
      predicate: f.predicate,
      current: f.current, // straight from expired_at IS NULL — never from invalid_at
    });
  }
  return { nodes, links };
}

/** One Fact touching a selected Entity, shaped for the detail panel. */
export interface EntityFact {
  id: string;
  predicate: string;
  /** "out" = the Entity is the subject; "in" = the Entity is the object. */
  direction: "out" | "in";
  /** The counterpart Entity's display name. */
  other: string;
  current: boolean;
  validAt: string | null;
  invalidAt: string | null;
  reinforcedBy: number;
}

/**
 * The Facts touching one Entity, shaped for the click-to-inspect panel: each with
 * its direction (Entity as subject vs object), the counterpart name, temporal
 * interval, Current flag, and provenance count. Current Facts first, then by
 * predicate, then counterpart — a stable, readable order. Pure: derived from the
 * already-fetched snapshot, so the panel needs no extra query.
 */
export function factsForEntity(snapshot: Snapshot, entityId: string): EntityFact[] {
  const nameById = new Map(snapshot.entities.map((e) => [e.id, e.name]));
  const rows: EntityFact[] = [];
  for (const f of snapshot.facts) {
    const isSubject = f.subjectId === entityId;
    const isObject = f.objectId === entityId;
    if (!isSubject && !isObject) continue;
    const otherId = isSubject ? f.objectId : f.subjectId;
    const other = (isSubject ? f.object : f.subject) ?? nameById.get(otherId) ?? otherId;
    rows.push({
      id: f.id,
      predicate: f.predicate,
      direction: isSubject ? "out" : "in",
      other,
      current: f.current,
      validAt: f.validAt,
      invalidAt: f.invalidAt,
      reinforcedBy: f.reinforcedBy ?? 0,
    });
  }
  rows.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1; // Current first
    if (a.predicate !== b.predicate) return a.predicate < b.predicate ? -1 : 1;
    return a.other < b.other ? -1 : a.other > b.other ? 1 : 0;
  });
  return rows;
}

/**
 * Edge width for the graph. Superseded Facts stay thin so they never visually
 * dominate the Current ones (Current vs superseded stays the primary read).
 * A Current Fact's width grows gently with how many Sources reinforce it, so a
 * well-confirmed relationship reads as bolder at a glance — capped so a heavily
 * cited edge can't blow out the layout. Pure, so it's unit-tested.
 */
export function factLinkWidth(current: boolean, reinforcedBy: number): number {
  if (!current) return 0.8;
  const extraSources = Math.min(Math.max(reinforcedBy - 1, 0), 4); // 0..4 beyond the first
  return 1.4 + extraSources * 0.6; // 1.4 (1 source) … 3.8 (≥5 sources)
}

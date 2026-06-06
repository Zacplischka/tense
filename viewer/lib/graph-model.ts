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

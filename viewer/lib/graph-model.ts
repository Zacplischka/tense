/**
 * Pure mapping from a graph snapshot to a renderable model. No DB, no React, so
 * it is unit-testable — and it is the one place the viewer decides what counts as
 * Current. It trusts the snapshot's `current` flag (which the query derives from
 * `expired_at IS NULL`, matching the store's partial index) and NEVER recomputes
 * "current" from `invalid_at` — valid time and transaction time are distinct.
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

export interface GraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  predicate: string;
  /** Solid when true; dashed/greyed when false. */
  current: boolean;
  source: GraphNode;
  target: GraphNode;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Node circle radius from the center. */
  radius: number;
}

const DEFAULT_LAYOUT: LayoutOptions = { width: 900, height: 600, radius: 230 };

/**
 * Deterministic radial layout: entities sorted by name are placed evenly on a
 * circle. Deterministic positioning matters for the recorded demo — only the
 * edge styling changes during a Supersession, never the node positions, so the
 * grey-out is the single visible change.
 */
export function toGraphModel(snapshot: Snapshot, layout: LayoutOptions = DEFAULT_LAYOUT): GraphModel {
  const { width, height, radius } = layout;
  const cx = width / 2;
  const cy = height / 2;

  const ordered = [...snapshot.entities].sort((a, b) => a.name.localeCompare(b.name));
  const count = Math.max(ordered.length, 1);

  const nodes: GraphNode[] = ordered.map((entity, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      id: entity.id,
      name: entity.name,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges: GraphEdge[] = [];
  for (const fact of snapshot.facts) {
    const source = nodeById.get(fact.subjectId);
    const target = nodeById.get(fact.objectId);
    if (!source || !target) continue; // orphan guard
    edges.push({
      id: fact.id,
      sourceId: fact.subjectId,
      targetId: fact.objectId,
      predicate: fact.predicate,
      current: fact.current, // straight from expired_at IS NULL — never from invalid_at
      source,
      target,
    });
  }

  return { nodes, edges };
}

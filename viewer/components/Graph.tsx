"use client";

import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";

/** Runtime node/link shapes — the force-graph library adds x/y/vx/vy/fx/fy. */
type FNode = { id: string; name: string; x?: number; y?: number; fx?: number; fy?: number };
type FLink = {
  id: string;
  source: string | FNode;
  target: string | FNode;
  predicate: string;
  current: boolean;
  /** Enrichment for the hover tooltip (optional; absent in minimal callers). */
  subject?: string;
  object?: string;
  validAt?: string | null;
  invalidAt?: string | null;
  reinforcedBy?: number;
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c] ?? c);
const fmtDate = (d: string | null | undefined): string => (d ? d.slice(0, 10) : "—");

/**
 * Rich hover tooltip for a Fact edge: the subject→predicate→object triple, its
 * validity interval, whether it is Current or Superseded, and how many Sources
 * reinforce it (ADR 0005). Surfaces in the UI the bi-temporal + provenance signal
 * the graph already carries. Returned as HTML — react-force-graph renders
 * linkLabel as a tooltip's innerHTML, so entity names are escaped.
 */
function linkTooltip(l: FLink): string {
  const subj = esc(l.subject ?? "");
  const obj = esc(l.object ?? "");
  const pred = esc(l.predicate);
  const status = l.current ? "Current" : "Superseded";
  const interval = `valid ${fmtDate(l.validAt)} → ${l.current ? "now" : fmtDate(l.invalidAt)}`;
  const n = l.reinforcedBy ?? 0;
  const sources = n > 0 ? ` · ${n} source${n === 1 ? "" : "s"}` : "";
  return (
    `<div style="font:12px ui-sans-serif,system-ui,sans-serif;line-height:1.5">` +
    `<div><b>${subj}</b> <span style="opacity:.7">${pred}</span> <b>${obj}</b></div>` +
    `<div style="opacity:.8">${status} · ${interval}${sources}</div>` +
    `</div>`
  );
}

export interface GraphProps {
  data: { nodes: FNode[]; links: FLink[] };
  width: number;
  height: number;
  /** Entity ids to glow (newly arrived this session). */
  highlightedIds: Set<string>;
  /** The clicked Entity (ringed for emphasis), or null. */
  selectedId?: string | null;
  /** Click a node to select it; click the background to clear (null). */
  onSelect?: (id: string | null) => void;
}

const NODE_R = 5; // graph-units; rendered radius scales with zoom

function endId(end: string | FNode): string {
  return typeof end === "object" ? end.id : end;
}

/**
 * Obsidian-style interactive knowledge graph (canvas, live force simulation,
 * pan / zoom / drag). Temporal semantics are preserved: Current Facts are solid
 * and arrowed, superseded Facts are dashed and greyed, and just-arrived Entities
 * glow green. Labels fade in as you zoom.
 */
export default function Graph({ data, width, height, highlightedIds, selectedId, onSelect }: GraphProps) {
  const fgRef = useRef<any>(null);
  const hoverIdRef = useRef<string | null>(null);
  const neighborsRef = useRef<Set<string>>(new Set());
  const fitPending = useRef(true);
  const prevNodeCount = useRef(0);

  // Adjacency for hover-highlighting (and to dim the rest).
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = endId(l.source);
      const t = endId(l.target);
      (m.get(s) ?? m.set(s, new Set()).get(s)!).add(t);
      (m.get(t) ?? m.set(t, new Set()).get(t)!).add(s);
    }
    return m;
  }, [data.links]);

  // Spread nodes apart. d3-force's defaults (charge -30, link distance 30) pack
  // a small graph into a tight knot; stronger repulsion + longer links give the
  // Obsidian-style breathing room. distanceMax caps the blow-apart on big graphs
  // so they don't fly off; zoomToFit (onEngineStop) reframes whatever the size.
  // Re-applied whenever topology changes — react-force-graph keeps the same
  // simulation object, but reheating with these forces re-settles the layout.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength(-260).distanceMax(520);
    fg.d3Force("link")?.distance(90);
    fg.d3ReheatSimulation?.();
  }, [data]);

  // Re-fit the view when new Entities appear, so growth stays in frame. (The
  // library already re-heats the simulation when graphData changes, so the fit
  // in onEngineStop runs against the SETTLED layout.)
  useEffect(() => {
    if (data.nodes.length > prevNodeCount.current) fitPending.current = true;
    prevNodeCount.current = data.nodes.length;
  }, [data]);

  // Repaint when the glow set or the selection changes (sim may already be cool).
  useEffect(() => {
    fgRef.current?.refresh?.();
  }, [highlightedIds, selectedId]);

  const dimmed = (id: string): boolean => {
    const hov = hoverIdRef.current;
    if (!hov) return false;
    return id !== hov && !neighborsRef.current.has(id);
  };

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={data}
      width={width}
      height={height}
      backgroundColor="#ffffff"
      cooldownTime={4000}
      d3VelocityDecay={0.3}
      nodeLabel={(n: FNode) => n.name}
      nodeRelSize={NODE_R}
      onNodeHover={(node: FNode | null) => {
        hoverIdRef.current = node?.id ?? null;
        neighborsRef.current = node ? adjacency.get(node.id) ?? new Set() : new Set();
        fgRef.current?.refresh?.();
      }}
      onNodeClick={(node: FNode) => onSelect?.(node.id)}
      onBackgroundClick={() => onSelect?.(null)}
      onNodeDragEnd={(node: FNode) => {
        node.fx = node.x;
        node.fy = node.y; // pin where dropped (Obsidian-style)
      }}
      onEngineStop={() => {
        if (fitPending.current) {
          fgRef.current?.zoomToFit?.(450, 36);
          fitPending.current = false;
        }
      }}
      nodeCanvasObject={(node: FNode, ctx: CanvasRenderingContext2D, scale: number) => {
        const isNew = highlightedIds.has(node.id);
        const isSelected = node.id === selectedId;
        const dim = dimmed(node.id);
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        ctx.globalAlpha = dim ? 0.12 : 1;

        ctx.beginPath();
        ctx.arc(x, y, NODE_R, 0, 2 * Math.PI);
        ctx.fillStyle = isSelected ? "#c7d2fe" : "#eef2ff";
        ctx.fill();
        if (isNew) {
          ctx.shadowColor = "#22c55e";
          ctx.shadowBlur = 16;
        }
        ctx.lineWidth = (isNew ? 2.2 : isSelected ? 2.8 : 1.4) / scale;
        ctx.strokeStyle = isNew
          ? "#22c55e"
          : isSelected || node.id === hoverIdRef.current
            ? "#4338ca"
            : "#6366f1";
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (scale > 0.55) {
          const fontSize = 11 / scale;
          ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "#1e293b";
          const label = node.name.length > 22 ? node.name.slice(0, 21) + "…" : node.name;
          ctx.fillText(label, x, y + NODE_R + 2 / scale);
        }
        ctx.globalAlpha = 1;
      }}
      nodePointerAreaPaint={(node: FNode, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, NODE_R + 1.5, 0, 2 * Math.PI);
        ctx.fill();
      }}
      linkColor={(l: FLink) => {
        const faded = hoverIdRef.current && !(neighborsRef.current.has(endId(l.source)) || neighborsRef.current.has(endId(l.target)) || endId(l.source) === hoverIdRef.current || endId(l.target) === hoverIdRef.current);
        if (faded) return "rgba(148,163,184,0.12)";
        return l.current ? "#64748b" : "#cbd5e1";
      }}
      linkWidth={(l: FLink) => (l.current ? 1.4 : 0.8)}
      linkLineDash={(l: FLink) => (l.current ? null : [3, 3])}
      linkDirectionalArrowLength={(l: FLink) => (l.current ? 3.5 : 0)}
      linkDirectionalArrowRelPos={0.94}
      linkDirectionalArrowColor={(l: FLink) => (l.current ? "#475569" : "#cbd5e1")}
      linkLabel={(l: FLink) => linkTooltip(l)}
      linkCanvasObjectMode={() => "after"}
      linkCanvasObject={(l: FLink, ctx: CanvasRenderingContext2D, scale: number) => {
        if (scale < 2.2) return; // predicate labels only when zoomed in (less clutter; hover shows them too)
        const s = l.source;
        const t = l.target;
        if (typeof s !== "object" || typeof t !== "object") return;
        const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
        const my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
        const fontSize = 8 / scale;
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = l.current ? "#94a3b8" : "#cbd5e1";
        ctx.fillText(l.predicate, mx, my);
      }}
    />
  );
}

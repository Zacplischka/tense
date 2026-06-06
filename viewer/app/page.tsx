"use client";

import { useEffect, useRef, useState } from "react";
import { toGraphModel, type GraphEdge, type Snapshot } from "../lib/graph-model";

const WIDTH = 900;
const HEIGHT = 600;
const NODE_R = 34;
const POLL_MS = 1000;

const EMPTY: Snapshot = { entities: [], facts: [] };

export default function Page() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/graph", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (alive) {
          setSnapshot(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "fetch failed");
      }
    };
    poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const model = toGraphModel(snapshot, { width: WIDTH, height: HEIGHT, radius: 230 });
  const currentCount = model.edges.filter((e) => e.current).length;
  const supersededCount = model.edges.length - currentCount;

  return (
    <main style={{ maxWidth: WIDTH, margin: "0 auto", padding: "28px 20px" }}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>
          Tense <span style={{ color: "#64748b", fontWeight: 400 }}>— which version is true</span>
        </h1>
        <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 8, fontSize: 13, color: "#475569" }}>
          <Legend solid label={`Current (${currentCount})`} />
          <Legend solid={false} label={`Superseded (${supersededCount})`} />
          <span style={{ marginLeft: "auto", color: error ? "#dc2626" : "#94a3b8" }}>
            {error ? `⚠ ${error}` : `live · polling ${POLL_MS}ms`}
          </span>
        </div>
      </header>

      <svg
        width="100%"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12 }}
      >
        <defs>
          <marker id="arrow-current" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f2937" />
          </marker>
          <marker id="arrow-superseded" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#cbd5e1" />
          </marker>
        </defs>

        {model.edges.map((edge) => (
          <Edge key={edge.id} edge={edge} />
        ))}

        {model.nodes.map((node) => (
          <g key={node.id}>
            <circle cx={node.x} cy={node.y} r={NODE_R} fill="#eef2ff" stroke="#6366f1" strokeWidth={2} />
            <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={600} fill="#1e1b4b">
              {node.name}
            </text>
          </g>
        ))}

        {model.nodes.length === 0 && (
          <text x={WIDTH / 2} y={HEIGHT / 2} textAnchor="middle" fill="#94a3b8" fontSize={15}>
            No Facts yet — remember something.
          </text>
        )}
      </svg>
    </main>
  );
}

function Edge({ edge }: { edge: GraphEdge }) {
  // Shorten the segment so it meets the node circles, not their centers.
  const dx = edge.target.x - edge.source.x;
  const dy = edge.target.y - edge.source.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x1 = edge.source.x + ux * NODE_R;
  const y1 = edge.source.y + uy * NODE_R;
  const x2 = edge.target.x - ux * (NODE_R + 8);
  const y2 = edge.target.y - uy * (NODE_R + 8);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  const color = edge.current ? "#1f2937" : "#cbd5e1";
  const label = edge.predicate;

  return (
    <g
      data-fact-id={edge.id}
      data-current={edge.current ? "true" : "false"}
      style={{ transition: "opacity 400ms ease, stroke 400ms ease" }}
      opacity={edge.current ? 1 : 0.65}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={edge.current ? 2.5 : 1.5}
        strokeDasharray={edge.current ? undefined : "7 5"}
        markerEnd={`url(#${edge.current ? "arrow-current" : "arrow-superseded"})`}
      />
      <g transform={`translate(${mx}, ${my})`}>
        <rect x={-label.length * 3.6 - 6} y={-10} width={label.length * 7.2 + 12} height={20} rx={6} fill="#ffffff" stroke={edge.current ? "#e2e8f0" : "#eef2f7"} />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fill={edge.current ? "#334155" : "#94a3b8"}
          fontStyle={edge.current ? "normal" : "italic"}
        >
          {label}
        </text>
      </g>
    </g>
  );
}

function Legend({ solid, label }: { solid: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width="34" height="10">
        <line x1="0" y1="5" x2="34" y2="5" stroke={solid ? "#1f2937" : "#cbd5e1"} strokeWidth={solid ? 2.5 : 1.5} strokeDasharray={solid ? undefined : "7 5"} />
      </svg>
      {label}
    </span>
  );
}

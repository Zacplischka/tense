"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { factsForEntity, type EntityFact, type Snapshot } from "../lib/graph-model";

// Canvas/WebGL graph must be client-only (it touches `window`); it owns its ref.
const Graph = dynamic(() => import("../components/Graph"), {
  ssr: false,
  loading: () => <div style={{ height: 600 }} />,
});

const POLL_MS = 1000;
const HIGHLIGHT_MS = 1800;
const GRAPH_HEIGHT = 600;

const EMPTY: Snapshot = { entities: [], facts: [] };

type IngestStatus = "idle" | "working" | "done" | "error";
type FNode = { id: string; name: string };

export default function Page() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [text, setText] = useState("");
  const [status, setStatus] = useState<IngestStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  const [graphWidth, setGraphWidth] = useState(880);
  const wrapRef = useRef<HTMLDivElement>(null);

  // --- live polling -------------------------------------------------------
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

  // --- responsive width ---------------------------------------------------
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setGraphWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- stable graph data: reuse node objects so positions persist across polls
  const nodeCache = useRef<Map<string, FNode>>(new Map());
  const topoSig =
    snapshot.entities.map((e) => e.id).join(",") +
    "|" +
    // include current + reinforcedBy so a Supersession OR a Reaffirmation rebuilds
    // the links (and refreshes the hover tooltip) without disturbing node positions.
    snapshot.facts.map((f) => `${f.id}:${f.current ? 1 : 0}:${f.reinforcedBy ?? 0}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graphData = useMemo(() => {
    const cache = nodeCache.current;
    const present = new Set<string>();
    const nodes = snapshot.entities.map((e) => {
      present.add(e.id);
      const existing = cache.get(e.id);
      if (existing) {
        existing.name = e.name;
        return existing;
      }
      const n: FNode = { id: e.id, name: e.name };
      cache.set(e.id, n);
      return n;
    });
    for (const id of Array.from(cache.keys())) if (!present.has(id)) cache.delete(id);
    const links = snapshot.facts
      .filter((f) => present.has(f.subjectId) && present.has(f.objectId))
      .map((f) => ({
        id: f.id,
        source: f.subjectId,
        target: f.objectId,
        predicate: f.predicate,
        current: f.current,
        subject: f.subject,
        object: f.object,
        validAt: f.validAt,
        invalidAt: f.invalidAt,
        reinforcedBy: f.reinforcedBy,
      }));
    return { nodes, links };
  }, [topoSig]);

  const currentCount = graphData.links.filter((l) => l.current).length;
  const supersededCount = graphData.links.length - currentCount;

  // Click-to-inspect: the selected Entity and its Facts, derived from the snapshot
  // already in hand (no extra request). Entities are append-only, so a selection
  // never goes stale.
  const selectedEntity = selectedId ? snapshot.entities.find((e) => e.id === selectedId) ?? null : null;
  const selectedFacts: EntityFact[] = selectedId ? factsForEntity(snapshot, selectedId) : [];

  // --- growth glow: green-highlight genuinely new Entities -----------------
  useEffect(() => {
    if (!initialized.current) {
      if (snapshot.entities.length === 0) return;
      snapshot.entities.forEach((e) => seen.current.add(e.id));
      initialized.current = true;
      return;
    }
    const fresh = snapshot.entities.map((e) => e.id).filter((id) => !seen.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => seen.current.add(id));
    setHighlightedIds((prev) => new Set([...prev, ...fresh]));
    const t = setTimeout(() => {
      setHighlightedIds((prev) => {
        const next = new Set(prev);
        fresh.forEach((id) => next.delete(id));
        return next;
      });
    }, HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [snapshot]);

  const submit = async () => {
    const body = text.trim();
    if (!body || status === "working") return;
    setStatus("working");
    setMessage(null);
    try {
      const res = await fetch("/api/remember", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, source: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const c = data.factsCreated?.length ?? 0;
      const s = data.factsSuperseded?.length ?? 0;
      const r = data.factsReaffirmed?.length ?? 0;
      setStatus("done");
      setMessage(
        c + s + r === 0
          ? "No Facts found in that text."
          : `✓ ${c} created · ${s} superseded · ${r} reaffirmed`,
      );
      if (c > 0) setText("");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "remember failed");
    }
  };

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px" }}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>
          Tense <span style={{ color: "#64748b", fontWeight: 400 }}>— watch the graph grow</span>
        </h1>
        <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 8, fontSize: 13, color: "#475569" }}>
          <Legend solid label={`Current (${currentCount})`} />
          <Legend solid={false} label={`Superseded (${supersededCount})`} />
          <span style={{ color: "#94a3b8" }}>· drag · scroll to zoom · hover to focus</span>
          <span style={{ marginLeft: "auto", color: error ? "#dc2626" : "#94a3b8" }}>
            {error ? `⚠ ${error}` : `live · ${POLL_MS}ms`}
          </span>
        </div>
      </header>

      <section style={{ marginBottom: 14 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          placeholder="Drop text here — e.g. 'Zach now reports to Bob.' — then Remember (⌘/Ctrl+Enter)."
          rows={3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "vertical",
            padding: "10px 12px",
            fontSize: 14,
            fontFamily: "inherit",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <button
            onClick={submit}
            disabled={status === "working" || text.trim().length === 0}
            style={{
              padding: "8px 18px",
              fontSize: 14,
              fontWeight: 600,
              color: "#ffffff",
              background: status === "working" || text.trim().length === 0 ? "#a5b4fc" : "#4f46e5",
              border: "none",
              borderRadius: 8,
              cursor: status === "working" || text.trim().length === 0 ? "default" : "pointer",
            }}
          >
            {status === "working" ? "Extracting…" : "Remember"}
          </button>
          {message && (
            <span style={{ fontSize: 13, color: status === "error" ? "#dc2626" : "#16a34a" }}>{message}</span>
          )}
        </div>
      </section>

      <div
        ref={wrapRef}
        style={{
          position: "relative",
          height: GRAPH_HEIGHT,
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <Graph
          data={graphData}
          width={graphWidth}
          height={GRAPH_HEIGHT}
          highlightedIds={highlightedIds}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {snapshot.entities.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#94a3b8", fontSize: 15, pointerEvents: "none" }}>
            No Facts yet — remember something.
          </div>
        )}
        {selectedEntity && (
          <aside
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 300,
              background: "rgba(255,255,255,0.97)",
              borderLeft: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              boxShadow: "-8px 0 24px -18px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid #eef2f7" }}>
              <strong style={{ fontSize: 15, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedEntity.name}
              </strong>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {selectedFacts.length} fact{selectedFacts.length === 1 ? "" : "s"}
              </span>
              <button
                onClick={() => setSelectedId(null)}
                aria-label="Close"
                style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 18, lineHeight: 1, color: "#64748b", cursor: "pointer" }}
              >
                ×
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "2px 14px 14px" }}>
              {selectedFacts.length === 0 ? (
                <div style={{ color: "#94a3b8", fontSize: 13, padding: "10px 0" }}>No Facts touch this Entity.</div>
              ) : (
                selectedFacts.map((f) => <FactRow key={f.id} fact={f} />)
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}

function FactRow({ fact }: { fact: EntityFact }) {
  const arrow = fact.direction === "out" ? "→" : "←";
  const from = fact.validAt ? fact.validAt.slice(0, 10) : "—";
  const to = fact.current ? "now" : fact.invalidAt ? fact.invalidAt.slice(0, 10) : "—";
  const sources = fact.reinforcedBy > 0 ? ` · ${fact.reinforcedBy} source${fact.reinforcedBy === 1 ? "" : "s"}` : "";
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9", opacity: fact.current ? 1 : 0.6 }}>
      <div style={{ fontSize: 13.5, color: "#1e293b" }}>
        <span style={{ color: "#94a3b8" }} title={fact.direction === "out" ? "this Entity is the subject" : "this Entity is the object"}>
          {arrow}
        </span>{" "}
        <span style={{ color: "#4f46e5" }}>{fact.predicate}</span> <b>{fact.other}</b>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
        {fact.current ? "Current" : "Superseded"} · valid {from} → {to}
        {sources}
      </div>
    </div>
  );
}

function Legend({ solid, label }: { solid: boolean; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width="34" height="10">
        <line x1="0" y1="5" x2="34" y2="5" stroke={solid ? "#475569" : "#cbd5e1"} strokeWidth={solid ? 2.5 : 1.5} strokeDasharray={solid ? undefined : "4 3"} />
      </svg>
      {label}
    </span>
  );
}

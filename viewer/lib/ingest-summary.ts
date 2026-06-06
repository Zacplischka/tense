/**
 * Build the human-facing one-line status shown after a `remember` ingest, from
 * the summary the API returns. Pure and framework-free so it is unit-tested in
 * the main suite (like graph-model), not just exercised through the UI.
 *
 * It surfaces two signals that would otherwise be invisible in the viewer:
 *  - fuzzy entity merges, so a wrong merge ("Zachery" → "Zachary") is caught
 *    rather than silently applied; and
 *  - WHY a Fact was superseded — a routine cardinality update vs a cross-Predicate
 *    contradiction (RememberSummary.SupersededFact.reason). A contradiction retires
 *    a Fact whose predicate differs from the one just stated, so an unexplained
 *    "1 superseded" is genuinely confusing without the reason.
 */

export interface IngestSummaryInput {
  factsCreated?: unknown[];
  factsSuperseded?: Array<{ reason?: string }>;
  factsReaffirmed?: unknown[];
  entitiesResolved?: Array<{ reason?: string; input: string; resolvedTo: string }>;
}

export function ingestSummaryMessage(data: IngestSummaryInput): string {
  const created = data.factsCreated?.length ?? 0;
  const superseded = data.factsSuperseded?.length ?? 0;
  const reaffirmed = data.factsReaffirmed?.length ?? 0;
  if (created + superseded + reaffirmed === 0) return "No Facts found in that text.";

  const contradictions = (data.factsSuperseded ?? []).filter((f) => f.reason === "contradiction").length;
  const supersededLabel = contradictions
    ? `${superseded} superseded (${contradictions} by contradiction)`
    : `${superseded} superseded`;

  const merges = (data.entitiesResolved ?? [])
    .filter((e) => e.reason === "fuzzy")
    .map((e) => `${e.input}→${e.resolvedTo}`);
  const mergeNote = merges.length ? ` · merged ${merges.join(", ")}` : "";

  return `✓ ${created} created · ${supersededLabel} · ${reaffirmed} reaffirmed${mergeNote}`;
}

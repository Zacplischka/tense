import { z } from "zod";
import type { Fact } from "../domain/types.js";
import type { TemporalGraphStore, FactClose } from "../db/store.js";
import type { ProviderClient } from "../provider/types.js";
import { closeIntervals, existingIsNewer } from "../supersession/resolver.js";

/**
 * LLM-judged contradiction (slice 12, ADR 0002) — the general path cardinality
 * can't express (cross-Predicate "works-at" vs "left", state flips). Mechanism
 * (from Graphiti's resolve_edge_contradictions): retrieve candidate current
 * Facts → ONE LLM call nominates which the new Fact contradicts → the SAME
 * valid-time direction rule from slice 03 sets which Fact closes.
 *
 * Kept off the critical demo path (the demo runs on deterministic cardinality);
 * because the LLM step is nondeterministic, acceptance is metric-based.
 */

export interface NewFactRef {
  id: string;
  subjectId: string;
  subject: string;
  predicate: string;
  object: string;
  validAt: Date | null;
}

export interface ContradictionDeps {
  store: TemporalGraphStore;
  provider: ProviderClient;
  now?: () => Date;
  /** Override the contradiction model (defaults to the provider's completion model). */
  model?: string;
}

const NominationSchema = z.object({ contradicted_ids: z.array(z.string()).default([]) });

const SYSTEM_PROMPT = `You detect temporal contradictions between facts about the same subject.
Two facts CONTRADICT when they cannot both be true of the subject at the same time
(e.g. "works-at Acme" vs "left Acme"; "lives-in Berlin" vs "lives-in Munich").
Facts that can coexist (e.g. "knows Ann" and "knows Ben") do NOT contradict.
Return STRICT JSON: { "contradicted_ids": string[] } listing the ids of EXISTING
facts that the NEW fact contradicts. Empty array if none.`;

/**
 * Detect and resolve contradictions for a just-inserted Fact. Returns the Facts
 * that were superseded (closed). Best-effort: any LLM/parse failure resolves to
 * "no contradictions" so ingestion never breaks.
 */
export async function resolveContradictions(
  deps: ContradictionDeps,
  newFact: NewFactRef,
): Promise<Fact[]> {
  const now = (deps.now ?? (() => new Date()))();

  // Candidate set: the subject's other Current Facts (different identity).
  const candidates = (await deps.store.currentFactsForSubject(newFact.subjectId)).filter(
    (c) => c.id !== newFact.id && !(c.predicate === newFact.predicate && c.object === newFact.object),
  );
  if (candidates.length === 0) return [];

  const contradictedIds = await nominate(deps, newFact, candidates);
  if (contradictedIds.length === 0) return [];

  const closes: FactClose[] = [];
  let newFactBornExpired: FactClose | null = null;

  for (const id of contradictedIds) {
    const existing = candidates.find((c) => c.id === id);
    if (!existing) continue;
    // Same direction rule as cardinality: the Fact with the earlier valid_at
    // closes; null/tie defers to transaction time (the new Fact is newer).
    if (existingIsNewer({ id, validAt: existing.validAt, createdAt: existing.createdAt }, newFact.validAt)) {
      // The new Fact is actually older -> it is the one that closes.
      newFactBornExpired = { factId: newFact.id, ...closeIntervals(existing.validAt, now) };
    } else {
      closes.push({ factId: existing.id, ...closeIntervals(newFact.validAt, now) });
    }
  }

  if (newFactBornExpired) closes.push(newFactBornExpired);
  return deps.store.expireFacts(closes);
}

async function nominate(
  deps: ContradictionDeps,
  newFact: NewFactRef,
  candidates: Array<{ id: string; predicate: string; object: string }>,
): Promise<string[]> {
  const list = candidates.map((c) => `  - id=${c.id}: ${newFact.subject} ${c.predicate} ${c.object}`).join("\n");
  const prompt = `NEW fact: ${newFact.subject} ${newFact.predicate} ${newFact.object}

EXISTING facts:
${list}

Which EXISTING facts does the NEW fact contradict?`;

  try {
    const { text } = await deps.provider.complete({
      system: SYSTEM_PROMPT,
      prompt,
      json: true,
      temperature: 0,
      model: deps.model,
    });
    const parsed = NominationSchema.safeParse(JSON.parse(stripFences(text)));
    if (!parsed.success) return [];
    const valid = new Set(candidates.map((c) => c.id));
    return parsed.data.contradicted_ids.filter((id) => valid.has(id));
  } catch {
    return []; // best-effort: never break ingestion on a judge failure
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? (fenced[1] ?? trimmed) : trimmed;
}

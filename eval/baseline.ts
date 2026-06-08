import type { TemporalGraphStore } from "../src/db/store.js";
import type { ProviderClient } from "../src/provider/types.js";

/**
 * The fair vector-only baseline (slice 13): the strongest naive version, not a
 * strawman. It uses the SAME Sources and the SAME embedding model as Tense, does
 * top-k cosine retrieval over a candidate pool that INCLUDES superseded Facts
 * (`store.baselineCandidates`), and is ALLOWED a recency tiebreak. What it lacks
 * is a bi-temporal model — so it cannot filter by `as_of`. For a point-in-time
 * question whose answer changed, the historically-correct Fact is in its pool but
 * recency ranks the most-recent one first, which is exactly where it loses
 * honestly — a ranking choice, not blindness. That fairness property (superseded
 * Facts stay eligible) is locked by
 * `test/eval-baseline-fairness.integration.test.ts`.
 */
export async function baselineAnswer(
  store: TemporalGraphStore,
  provider: ProviderClient,
  question: string,
  topK = 5,
): Promise<string | null> {
  const [embedding] = await provider.embed([question]);
  if (!embedding) return null;

  const candidates = await store.baselineCandidates(embedding, topK);
  if (candidates.length === 0) return null;

  // Recency tiebreak: prefer the most recent by valid time, falling back to
  // transaction time when valid_at is null. (No `as_of` — the baseline has no
  // notion of point-in-time.)
  const recencyKey = (c: { validAt: Date | null; createdAt: Date }) =>
    (c.validAt ?? c.createdAt).getTime();

  return candidates.reduce((best, c) => (recencyKey(c) > recencyKey(best) ? c : best)).object;
}

/**
 * Reviewer-facing renderers for an {@link EvalReport}.
 *
 * The aggregate headline ("100% vs 0% on 5 point-in-time questions") is a round
 * number on a deliberately small gold set, so it invites the obvious skeptical
 * question: *which* questions, and *why* does the baseline lose each one? These
 * renderers answer that — a per-question table of gold vs Tense vs baseline — so
 * the headline reconciles row-by-row instead of on trust.
 *
 * Pure formatting (no DB, no model, no clock), so the output is deterministic and
 * the same function feeds both the terminal table and the committed `RESULTS.md`.
 */
import type { EvalReport, QaItem } from "./harness.js";
import type { GoldTag } from "./gold.js";

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const mark = (item: QaItem, got: string | null): string =>
  got !== null && got.toLowerCase() === item.gold.toLowerCase() ? "✓" : "✗";
const asOfLabel = (asOf: string | null): string => asOf ?? "now";
const dash = (s: string | null): string => s ?? "—";

/** One markdown table row per QA item: as_of · gold · Tense (✓/✗) · baseline (✓/✗). */
function qaTable(items: QaItem[]): string {
  const header =
    "| Scenario | Question | as_of | Gold | Tense | Baseline |\n" +
    "|---|---|---|---|---|---|";
  const rows = items.map(
    (i) =>
      `| ${i.scenario} | ${i.question} | \`${asOfLabel(i.asOf)}\` | ${i.gold} | ` +
      `${dash(i.tense)} ${mark(i, i.tense)} | ${dash(i.baseline)} ${mark(i, i.baseline)} |`,
  );
  return [header, ...rows].join("\n");
}

/**
 * The "what would catch a bug" gloss for each gold-set tag, plus the stable
 * display order. Kept here (presentation), not in the gold data — the harness only
 * supplies which tags are present and which scenarios carry them. `llm-only` is a
 * path marker, not an edge case, so it is folded into `cross-predicate` and omitted.
 */
const TAG_ORDER: GoldTag[] = [
  "changed-over-time",
  "supersession",
  "still-true",
  "out-of-order",
  "tied-valid-at",
  "null-valid-at",
  "multi-valued",
  "cross-predicate",
];
const TAG_GLOSS: Partial<Record<GoldTag, { label: string; catches: string }>> = {
  "changed-over-time": {
    label: "Answer changed over time",
    catches:
      "the gold answer differs from the latest value, so a recency-sorted vector baseline is structurally wrong at a past `as_of` — the headline cases",
  },
  supersession: {
    label: "Supersession fires",
    catches: "a single-valued Predicate gets a new value, so the prior Fact must close — never duplicate, never delete",
  },
  "still-true": {
    label: "Must NOT supersede",
    catches:
      "Facts that have to stay Current — these make false-supersession measurable; a memory that over-closes fails precisely here",
  },
  "out-of-order": {
    label: "Out-of-order ingestion",
    catches: "the older Fact arrives second and must be born already-closed, never supersede the newer one",
  },
  "tied-valid-at": {
    label: "Tied valid_at",
    catches: "two Facts share a valid_at, so only a transaction-time tiebreak can pick the winner",
  },
  "null-valid-at": {
    label: "Null valid_at",
    catches: "a Source carries no date, so supersession must fall back to transaction time",
  },
  "multi-valued": {
    label: "Multi-valued Predicate",
    catches: "an accumulating relation (knows, contributed-to) where new values add and must never replace",
  },
  "cross-predicate": {
    label: "Cross-Predicate contradiction",
    catches: "a conflict across different Predicates (works-at vs left), resolved by the LLM judge",
  },
};

/**
 * A coverage matrix over the gold-set tags: edge case · what a bug there looks
 * like · how many scenarios carry it. A round 100% invites "is the eval rigged to
 * pass?"; this answers it by showing the gold set is built to *break* Tense.
 */
function coverageSection(r: EvalReport): string {
  const byTag = new Map(r.coverage.map((c) => [c.tag, c.scenarios]));
  // Curated order first, then any present-but-uncatalogued tag (never silently
  // drop a dimension), excluding the `llm-only` path marker.
  const tags = [
    ...TAG_ORDER.filter((t) => byTag.has(t)),
    ...r.coverage.map((c) => c.tag).filter((t) => !TAG_ORDER.includes(t) && t !== "llm-only"),
  ];
  const rows = tags.map((tag) => {
    const n = byTag.get(tag)?.length ?? 0;
    const gloss = TAG_GLOSS[tag];
    return `| **${gloss?.label ?? tag}** | ${gloss?.catches ?? tag} | ${n} |`;
  });
  const stillTrue = byTag.get("still-true")?.length ?? 0;
  return `## What the gold set deliberately tests

A round 100% invites the obvious question — *is the eval rigged to pass?* So the
gold set is built to **break** Tense, not flatter it: every one of these
${r.scenarios} scenarios carries at least one adversarial property below, and
${stillTrue} are "still-true" cases whose Facts must stay Current — exactly what a
memory that over-supersedes gets *wrong*. Tags are declared per scenario in
[\`eval/gold.ts\`](./gold.ts), so this matrix can't drift from what was run.

| Edge case | What a bug here would look like | Scenarios |
|---|---|---|
${rows.join("\n")}
`;
}

/**
 * The committed `eval/RESULTS.md` snapshot — what a reviewer reads on GitHub
 * without running anything. Byte-identical on every offline run (no timestamps).
 */
export function renderResultsMarkdown(r: EvalReport): string {
  const changed = r.qa.items.filter((i) => i.changed);
  const s = r.supersession;
  // Denominators behind the supersession percentages, so "100%" reconciles against
  // a count a reviewer can audit in eval/gold.ts rather than trusting a round number.
  const recallCount = `${s.truePositives} / ${s.truePositives + s.falseNegatives} gold closures caught`;
  const precisionCount = `${s.truePositives} / ${s.truePositives + s.falsePositives} closures correct`;
  const falseCount = `${s.falsePositives} / ${s.shouldStayCurrent} still-true Facts closed`;
  return `<!-- Generated by \`pnpm eval:report\` (eval/run-offline.ts --write). Do not edit by hand. -->
# Tense — offline eval results

Generated by \`pnpm eval:offline\` — **stub extraction + bag-of-words embeddings,
Postgres only, no API key, no network**. Deterministic: byte-identical on every
run. Regenerate with \`pnpm eval:report\`. The one LLM-judged cross-Predicate
scenario is excluded offline (it needs a model); \`pnpm eval\` covers it.

![Temporal-QA accuracy: Tense ${pct(r.qa.changedOverTime.tense)} vs the fair vector baseline ${pct(r.qa.changedOverTime.baseline)} on the ${r.qa.changedCount} point-in-time questions, and ${pct(r.qa.overall.tense)} vs ${pct(r.qa.overall.baseline)} across all ${r.qa.count} questions.](../docs/media/accuracy.svg)

*Chart generated by the same \`pnpm eval:report\` run that wrote this file, so every
bar reconciles against the tables below.*

## Summary

| Metric (${r.scenarios} stub-extractable scenarios) | Tense | Fair vector baseline |
|---|---|---|
| **Temporal-QA — point-in-time (${r.qa.changedCount} questions)** | **${pct(r.qa.changedOverTime.tense)}** | **${pct(r.qa.changedOverTime.baseline)}** |
| Temporal-QA — all questions (${r.qa.count}) | ${pct(r.qa.overall.tense)} | ${pct(r.qa.overall.baseline)} |
| Supersession precision / recall | ${pct(r.supersession.precision)} / ${pct(r.supersession.recall)} | — |
| False-supersession rate | ${pct(r.supersession.falseSupersessionRate)} | — |
| Extraction triple-F1 / valid_at accuracy | ${pct(r.tripleF1)} / ${pct(r.validAtAccuracy)} | — |

Those supersession percentages are not round numbers on an unknown N. Across these
${r.scenarios} scenarios the gold set asserts Facts that *should* close and Facts that
*should stay Current* (the "still-true" cases that make false supersession
measurable at all):

- **Recall ${pct(r.supersession.recall)}** — ${recallCount}.
- **Precision ${pct(r.supersession.precision)}** — ${precisionCount}.
- **False-supersession ${pct(r.supersession.falseSupersessionRate)}** — ${falseCount}.

${coverageSection(r)}
## The headline, question by question

The ${r.qa.changedCount} point-in-time questions whose gold answer **changed over
time** — the one place a recency-sorted vector store is structurally wrong. Asked
at a past \`as_of\`, the baseline has no bi-temporal model, so it returns the
*most-recent* value and misses; Tense filters on valid time and returns who was
Current *then*.

${qaTable(changed)}

## Every question

Including the "now" questions, where the baseline is a fair competitor — it gets
most of them right, proof it is the strongest naive version, not a strawman. It
still misses one "now" question: the tied-\`valid_at\` tiebreak, where both Facts
share a \`valid_at\` so recency can't choose between them, and only Tense's
transaction-time tiebreak picks the later-ingested one.

${qaTable(r.qa.items)}
`;
}

/**
 * Compact terminal breakdown printed after the summary. Shows the point-in-time
 * rows (the bi-temporal win) AND the "now" control rows where the baseline
 * competes — so a reviewer running the command sees the baseline win the "now"
 * questions, not only lose the 5 point-in-time ones. That fairness is otherwise
 * only visible in RESULTS.md; surfacing it here keeps the terminal from reading
 * as if the baseline were a strawman it deliberately is not.
 */
export function renderQaBreakdown(r: EvalReport): string {
  const row = (i: QaItem): string => {
    const t = `${dash(i.tense)} ${mark(i, i.tense)}`;
    const b = `${dash(i.baseline)} ${mark(i, i.baseline)}`;
    return `  ${i.question} @ ${asOfLabel(i.asOf).padEnd(10)} gold=${i.gold.padEnd(7)} Tense=${t.padEnd(9)} baseline=${b}`;
  };
  const changed = r.qa.items.filter((i) => i.changed);
  const now = r.qa.items.filter((i) => !i.changed);
  const baseRight = (items: QaItem[]): number => items.filter((i) => mark(i, i.baseline) === "✓").length;

  return [
    `Point-in-time questions (gold answer changed over time) — the bi-temporal win:`,
    ...changed.map(row),
    ``,
    `"Now" questions (answer is the latest value) — where the baseline competes fairly:`,
    ...now.map(row),
    ``,
    `  → Baseline: ${baseRight(now)}/${now.length} on "now" questions vs ${baseRight(changed)}/${changed.length} on point-in-time.`,
    `    It is the strongest naive version, not a strawman — it competes on the "now"`,
    `    answers and loses the point-in-time set, where no single-time-axis store can win.`,
  ].join("\n");
}

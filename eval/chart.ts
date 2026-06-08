/**
 * Reviewer-facing accuracy chart for an {@link EvalReport}.
 *
 * The headline ("Tense beats a fair vector baseline on point-in-time questions")
 * lives as a table in RESULTS.md and the README, but a skeptical reviewer skims
 * before reading — so this renders the same numbers as a grouped bar chart: the
 * point-in-time win (where the baseline is structurally wrong) next to overall
 * accuracy (where the baseline competes fairly), making it obvious at a glance
 * that the win is surgical, not a strawman.
 *
 * Pure formatting from the report (no DB, no model, no clock), so the SVG is
 * byte-identical on every offline run and can be drift-guarded exactly like
 * `eval/RESULTS.md`.
 */
import type { EvalReport } from "./harness.js";

const TENSE = "#4f46e5"; // indigo — matches docs/media/point-in-time.svg
const BASELINE = "#94a3b8"; // slate — the fair vector baseline
const INK = "#0f172a";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const GREEN = "#16a34a";

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

// Plot geometry: a value of 1.0 spans BASE_Y - PLOT_H .. BASE_Y.
const BASE_Y = 300;
const PLOT_H = 200;
const BAR_W = 60;

/** One bar plus its value label; a 0% value renders as a stub on the axis. */
function bar(x: number, value: number, color: string): string {
  const h = value * PLOT_H;
  const y = BASE_Y - h;
  const label = `<text x="${x + BAR_W / 2}" y="${y - 9}" font-size="15" font-weight="700" fill="${color}" text-anchor="middle">${pct(value)}</text>`;
  if (h < 1) {
    // 0% — no rectangle to draw; mark the empty slot so the group still reads as two bars.
    return (
      `<rect x="${x}" y="${BASE_Y - 2}" width="${BAR_W}" height="2" fill="${color}" opacity="0.45"/>` +
      label
    );
  }
  return `<rect x="${x}" y="${y}" width="${BAR_W}" height="${h}" rx="3" fill="${color}"/>${label}`;
}

/**
 * Grouped bar chart of temporal-QA accuracy: point-in-time questions (the
 * headline) beside all questions (where the baseline competes). Deterministic.
 */
export function renderAccuracyChartSvg(r: EvalReport): string {
  const g = r.qa;
  // Two groups; Tense bar then baseline bar, centred under each group label.
  const g1 = 230; // point-in-time group, left edge of first bar
  const g2 = 470; // all-questions group
  const gap = 16;

  const bars = [
    bar(g1, g.changedOverTime.tense, TENSE),
    bar(g1 + BAR_W + gap, g.changedOverTime.baseline, BASELINE),
    bar(g2, g.overall.tense, TENSE),
    bar(g2 + BAR_W + gap, g.overall.baseline, BASELINE),
  ].join("\n  ");

  // Horizontal gridlines + axis labels at 0/25/50/75/100%.
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((v) => {
      const y = BASE_Y - v * PLOT_H;
      return (
        `<line x1="120" y1="${y}" x2="700" y2="${y}" stroke="#eef2f7" stroke-width="1"/>` +
        `<text x="108" y="${y + 4}" font-size="11" fill="${FAINT}" text-anchor="end">${v * 100}%</text>`
      );
    })
    .join("\n  ");

  const g1Centre = g1 + BAR_W + gap / 2;
  const g2Centre = g2 + BAR_W + gap / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 404" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" role="img" aria-label="Temporal-QA accuracy: Tense scores ${pct(g.changedOverTime.tense)} vs the fair vector baseline's ${pct(g.changedOverTime.baseline)} on the ${g.changedCount} point-in-time questions, and ${pct(g.overall.tense)} vs ${pct(g.overall.baseline)} across all ${g.count} questions.">
  <rect x="0" y="0" width="760" height="404" fill="#ffffff"/>

  <!-- title -->
  <text x="30" y="34" font-size="17" font-weight="700" fill="${INK}">Temporal-QA accuracy &#8212; Tense vs a fair vector baseline</text>
  <text x="30" y="55" font-size="12.5" fill="${MUTED}">Offline eval &#183; stub extraction + hashed embeddings &#183; no API key (<tspan font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="${INK}">pnpm eval:offline</tspan>)</text>

  <!-- legend (title row, right-aligned, clear of the plot) -->
  <rect x="556" y="24" width="12" height="12" rx="2" fill="${TENSE}"/>
  <text x="574" y="34" font-size="12" fill="${MUTED}">Tense</text>
  <rect x="620" y="24" width="12" height="12" rx="2" fill="${BASELINE}"/>
  <text x="638" y="34" font-size="12" fill="${MUTED}">Vector baseline</text>

  <!-- gridlines + y axis -->
  ${grid}

  <!-- bars -->
  ${bars}

  <!-- group labels -->
  <text x="${g1Centre}" y="${BASE_Y + 24}" font-size="13.5" font-weight="700" fill="${INK}" text-anchor="middle">Point-in-time (${g.changedCount})</text>
  <text x="${g1Centre}" y="${BASE_Y + 42}" font-size="11.5" fill="${MUTED}" text-anchor="middle">answer changed over time</text>
  <text x="${g2Centre}" y="${BASE_Y + 24}" font-size="13.5" font-weight="700" fill="${INK}" text-anchor="middle">All questions (${g.count})</text>
  <text x="${g2Centre}" y="${BASE_Y + 42}" font-size="11.5" fill="${MUTED}" text-anchor="middle">includes the &#8220;now&#8221; questions</text>

  <!-- caption -->
  <text x="30" y="378" font-size="12.5" fill="#475569">The baseline competes on the &#8220;now&#8221; questions &#8212; it loses precisely the ${g.changedCount} whose answer changed over</text>
  <text x="30" y="396" font-size="12.5" fill="#475569">time, where recency can&#8217;t help. <tspan fill="${GREEN}" font-weight="600">That gap is the bi-temporal model.</tspan></text>
</svg>
`;
}

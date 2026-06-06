"""
DSPy offline prompt optimizer for Tense extraction (ADR 0003).

Dev-only. Optimizes the extraction prompt against the same triple-F1 metric the
TS eval uses, then exports the winning instructions + bootstrapped few-shot
demonstrations as a STATIC asset (dspy/compiled/extraction.json) that the
TypeScript server loads at runtime. No Python ships.

A no-improvement outcome is an acceptable result: if the optimized program does
not beat the hand-tuned baseline, nothing is exported and the baseline ships
(the TS extractor falls back automatically).

Usage:
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    export OPENROUTER_API_KEY=sk-or-...        # same key as the TS app
    export TENSE_EXTRACTION_MODEL=openai/gpt-4o-mini
    pnpm tsx scripts/export-gold.ts            # writes dspy/gold.json
    python optimize.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import dspy

HERE = Path(__file__).parent
GOLD = HERE / "gold.json"
COMPILED = HERE / "compiled" / "extraction.json"

BASELINE_INSTRUCTIONS = (
    "Extract a temporal knowledge graph from the text. Identify entities and the "
    "directed subject->predicate->object facts between them. Use lowercase "
    "hyphenated predicate slugs (reports-to, lives-in, works-at, knows, left). Set "
    "valid_at to an ISO date only when the text states it, else null."
)


class ExtractGraph(dspy.Signature):
    """Extract entities and facts (subject, predicate, object, valid_at) from text."""

    source: str = dspy.InputField()
    facts: list[dict] = dspy.OutputField(desc="list of {subject, predicate, object, valid_at|null}")


def _norm(s: str) -> str:
    return (s or "").strip().lower()


def _triple_key(f: dict) -> str:
    return f"{_norm(f.get('subject'))}|{_norm(f.get('predicate'))}|{_norm(f.get('object'))}"


def triple_f1(example, pred, trace=None) -> float:
    """Triple-level F1 between predicted and gold facts (matches the TS metric)."""
    gold = {_triple_key(f) for f in example.facts}
    got = {_triple_key(f) for f in (pred.facts or [])}
    if not got:
        return 1.0 if not gold else 0.0
    tp = len(gold & got)
    precision = tp / len(got)
    recall = tp / len(gold) if gold else 1.0
    return 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)


def load_examples() -> list[dspy.Example]:
    rows = json.loads(GOLD.read_text())
    return [dspy.Example(source=r["source"], facts=r["facts"]).with_inputs("source") for r in rows]


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def main() -> None:
    api_key = os.environ["OPENROUTER_API_KEY"]
    model = os.environ.get("TENSE_EXTRACTION_MODEL", "openai/gpt-4o-mini")
    dspy.configure(
        lm=dspy.LM(
            f"openrouter/{model}",
            api_key=api_key,
            api_base="https://openrouter.ai/api/v1",
            temperature=0,
        )
    )

    examples = load_examples()

    baseline = dspy.Predict(ExtractGraph)
    baseline_f1 = mean([triple_f1(ex, baseline(source=ex.source)) for ex in examples])

    optimizer = dspy.BootstrapFewShot(metric=triple_f1, max_bootstrapped_demos=3)
    optimized = optimizer.compile(dspy.Predict(ExtractGraph), trainset=examples)
    optimized_f1 = mean([triple_f1(ex, optimized(source=ex.source)) for ex in examples])

    print("\n=== DSPy lift report ===")
    print(f"baseline  triple-F1: {baseline_f1:.3f}")
    print(f"optimized triple-F1: {optimized_f1:.3f}")

    if optimized_f1 > baseline_f1:
        demos = [
            {"source": d.source, "output": {"facts": d.facts}}
            for d in getattr(optimized, "demos", [])
            if getattr(d, "source", None)
        ]
        COMPILED.parent.mkdir(parents=True, exist_ok=True)
        COMPILED.write_text(
            json.dumps(
                {
                    "instructions": BASELINE_INSTRUCTIONS,
                    "demos": demos,
                    "meta": {"optimizer": "BootstrapFewShot", "baselineF1": baseline_f1, "optimizedF1": optimized_f1},
                },
                indent=2,
            )
            + "\n"
        )
        print(f"exported optimized prompt -> {COMPILED}")
    else:
        print("no lift over the hand-tuned baseline -> baseline ships (nothing exported).")


if __name__ == "__main__":
    main()

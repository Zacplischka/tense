import { describe, expect, it } from "vitest";
import { SMOKE_GOLD } from "../eval/smoke-gold.js";
import { createProvider } from "../src/provider/openrouter.js";
import { LlmExtractor } from "../src/extraction/llm-extractor.js";
import type { ExtractedFact } from "../src/extraction/types.js";

const hasKey = !!process.env.OPENROUTER_API_KEY;
const norm = (s: string) => s.trim().toLowerCase();

function findFact(
  expected: { subject: string; object: string },
  facts: ExtractedFact[],
): ExtractedFact | undefined {
  return facts.find((f) => norm(f.subject) === norm(expected.subject) && norm(f.object) === norm(expected.object));
}

// Live extraction quality check over the smoke gold set (slice 05).
describe.skipIf(!hasKey)("extraction smoke (live OpenRouter)", () => {
  it("extracts the expected Entities and Facts, with valid_at measured", async () => {
    const extractor = new LlmExtractor(createProvider());

    let expectedFacts = 0;
    let matchedFacts = 0;
    let predicateHits = 0;
    let validAtExpected = 0;
    let validAtHits = 0;
    let expectedEntities = 0;
    let matchedEntities = 0;
    const misses: string[] = [];

    for (const scenario of SMOKE_GOLD) {
      const { entities, facts } = await extractor.extract(scenario.source);

      for (const name of scenario.expectedEntities) {
        expectedEntities++;
        if (entities.some((e) => norm(e.name) === norm(name))) matchedEntities++;
      }

      for (const exp of scenario.expectedFacts) {
        expectedFacts++;
        const got = findFact(exp, facts);
        if (!got) {
          misses.push(`${scenario.name}: ${exp.subject}-${exp.predicate}->${exp.object}`);
          continue;
        }
        matchedFacts++;
        if (norm(got.predicate) === norm(exp.predicate)) predicateHits++;
        if (exp.validAt !== null) {
          validAtExpected++;
          if (got.validAt && got.validAt.toISOString().startsWith(exp.validAt)) validAtHits++;
        } else if (got.validAt === null) {
          validAtHits++;
          validAtExpected++;
        }
      }
    }

    const factRecall = matchedFacts / expectedFacts;
    const entityRecall = matchedEntities / expectedEntities;
    const predicateAccuracy = matchedFacts ? predicateHits / matchedFacts : 0;
    const validAtAccuracy = validAtExpected ? validAtHits / validAtExpected : 1;

    console.log(
      `[extraction smoke] entityRecall=${entityRecall.toFixed(2)} factRecall=${factRecall.toFixed(
        2,
      )} predicateAccuracy=${predicateAccuracy.toFixed(2)} validAtAccuracy=${validAtAccuracy.toFixed(
        2,
      )}` + (misses.length ? ` misses=${JSON.stringify(misses)}` : ""),
    );

    expect(factRecall).toBeGreaterThanOrEqual(0.8);
    expect(entityRecall).toBeGreaterThanOrEqual(0.8);
    expect(predicateAccuracy).toBeGreaterThanOrEqual(0.7);
  }, 60_000);
});

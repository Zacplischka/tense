import { describe, expect, it } from "vitest";
import {
  EXTRACTION_SYSTEM_PROMPT,
  resolveExtractionPrompt,
  type CompiledExtraction,
} from "../src/extraction/prompts.js";

describe("resolveExtractionPrompt (DSPy static-asset seam)", () => {
  it("falls back to the hand-tuned baseline when no compiled asset exists", () => {
    const { system, fewShot } = resolveExtractionPrompt(null);
    expect(system).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(fewShot).toBe("");
  });

  it("uses compiled instructions and renders few-shot demonstrations", () => {
    const compiled: CompiledExtraction = {
      instructions: "OPTIMIZED INSTRUCTIONS",
      demos: [{ source: "Zach reports to Bob.", output: { facts: [{ subject: "Zach" }] } }],
    };
    const { system, fewShot } = resolveExtractionPrompt(compiled);
    expect(system).toBe("OPTIMIZED INSTRUCTIONS");
    expect(fewShot).toContain("Examples:");
    expect(fewShot).toContain("Zach reports to Bob.");
    expect(fewShot).toContain('"subject":"Zach"');
  });

  it("keeps the baseline instructions if the compiled asset has empty instructions", () => {
    const { system } = resolveExtractionPrompt({ instructions: "", demos: [] });
    expect(system).toBe(EXTRACTION_SYSTEM_PROMPT);
  });
});

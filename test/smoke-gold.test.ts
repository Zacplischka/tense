import { describe, expect, it } from "vitest";
import { SMOKE_GOLD } from "../eval/smoke-gold.js";

// Slice 04: validate the smoke gold set is well-formed and has the required
// coverage. (Content is AFK-authored; HITL quality sign-off pending.)
describe("smoke gold set", () => {
  it("is non-empty and every scenario is well-formed", () => {
    expect(SMOKE_GOLD.length).toBeGreaterThan(0);
    for (const s of SMOKE_GOLD) {
      expect(s.name).toBeTruthy();
      expect(s.source.trim().length).toBeGreaterThan(0);
      expect(s.expectedFacts.length).toBeGreaterThan(0);
      for (const f of s.expectedFacts) {
        expect(f.subject && f.predicate && f.object).toBeTruthy();
        // Every Fact's subject and object must be declared entities.
        expect(s.expectedEntities).toContain(f.subject);
        expect(s.expectedEntities).toContain(f.object);
        // valid_at is an ISO date or null.
        if (f.validAt !== null) expect(f.validAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
    }
  });

  it("covers at least one supersession and one null-valid_at scenario", () => {
    const tags = new Set(SMOKE_GOLD.flatMap((s) => s.tags));
    expect(tags.has("supersession")).toBe(true);
    expect(tags.has("null-valid-at")).toBe(true);
  });
});

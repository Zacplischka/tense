import { describe, expect, it } from "vitest";
import { defaultPredicateRegistry, PredicateRegistry } from "../src/supersession/registry.js";

describe("PredicateRegistry", () => {
  it("resolves seeded demo Predicates to their cardinality", () => {
    const r = defaultPredicateRegistry();
    expect(r.cardinalityOf("reports-to")).toBe("single");
    expect(r.cardinalityOf("lives-in")).toBe("single");
    expect(r.cardinalityOf("knows")).toBe("multi");
    expect(r.cardinalityOf("contributed-to")).toBe("multi");
  });

  it("defaults unknown Predicates to multi-valued (fail-safe — never wrongly closes history)", () => {
    const r = defaultPredicateRegistry();
    expect(r.cardinalityOf("invented-by")).toBe("multi");
  });

  it("accepts a custom mapping", () => {
    const r = new PredicateRegistry({ "married-to": "single" });
    expect(r.cardinalityOf("married-to")).toBe("single");
    expect(r.cardinalityOf("reports-to")).toBe("multi"); // not in the custom map
  });
});

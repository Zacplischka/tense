import { describe, expect, it } from "vitest";
import { clampLimit, formatVector, normalizeName } from "../src/db/store.js";

/**
 * Pure-function guards in the store. No database — these pin the edge-case
 * behavior the SQL layer relies on, especially clampLimit, which sanitizes the
 * caller-supplied LIMIT that gets string-interpolated into queries.
 */

describe("clampLimit", () => {
  it("passes through ordinary positive integers", () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(20)).toBe(20);
    expect(clampLimit(200)).toBe(200);
  });

  it("floors fractional limits to an integer", () => {
    expect(clampLimit(5.9)).toBe(5);
    expect(clampLimit(0.9)).toBe(1); // floors to 0, then 0 -> 1
  });

  it("clamps zero and negatives up to 1", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(-0.5)).toBe(1);
  });

  it("clamps above-max values (incl. +Infinity) down to 200", () => {
    expect(clampLimit(201)).toBe(200);
    expect(clampLimit(10_000)).toBe(200);
    expect(clampLimit(Number.POSITIVE_INFINITY)).toBe(200);
  });

  it("maps NaN and -Infinity to the safe floor of 1", () => {
    expect(clampLimit(Number.NaN)).toBe(1);
    expect(clampLimit(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it("always returns a safe integer in [1, 200] for adversarial inputs", () => {
    for (const input of [-1e9, -1, -0, 0, 0.4, 1, 199.99, 200, 201, 1e9, NaN, Infinity, -Infinity]) {
      const out = clampLimit(input);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(1);
      expect(out).toBeLessThanOrEqual(200);
    }
  });
});

describe("formatVector", () => {
  it("renders a number array as a pgvector literal", () => {
    expect(formatVector([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("renders an empty vector", () => {
    expect(formatVector([])).toBe("[]");
  });

  it("preserves negative and integer components without spaces", () => {
    expect(formatVector([-1, 0, 2])).toBe("[-1,0,2]");
  });
});

describe("normalizeName", () => {
  it("lowercases and trims surrounding whitespace", () => {
    expect(normalizeName("  Zach  ")).toBe("zach");
    expect(normalizeName("ALICE")).toBe("alice");
  });

  it("is idempotent", () => {
    const once = normalizeName("  Bob Smith ");
    expect(normalizeName(once)).toBe(once);
  });

  it("leaves interior whitespace untouched (only ends are trimmed)", () => {
    expect(normalizeName("Acme  Corp")).toBe("acme  corp");
  });
});

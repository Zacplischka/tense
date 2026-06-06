import type { CompletionResult, ProviderClient } from "../../src/provider/types.js";

/**
 * Deterministic embedding double for the eval harness test: hashes tokens into a
 * fixed 1536-dim term-frequency vector (L2-normalized). Lets the fair baseline do
 * real cosine retrieval without a network call, so the headline (Tense beats
 * baseline on as_of) is proven deterministically. Not a quality model — just a
 * stable, dependency-free stand-in. Matches the migration's vector(1536).
 */
const DIM = 1536;

export class BagOfWordsProvider implements ProviderClient {
  async complete(): Promise<CompletionResult> {
    throw new Error("BagOfWordsProvider.complete is not used in the eval harness");
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(embedOne);
  }
}

function embedOne(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    v[hash(token) % DIM]! += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

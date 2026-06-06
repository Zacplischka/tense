import { describe, expect, it } from "vitest";
import { OpenRouterClient, createProvider } from "../src/provider/openrouter.js";

interface RecordedCall {
  url: string;
  body: any;
  auth: string | null;
}

/** A fake fetch that records requests and returns canned OpenAI-shaped JSON. */
function recordingFetch(calls: RecordedCall[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    if (u.endsWith("/chat/completions")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({ data: [{ index: 1, embedding: [4, 5, 6] }, { index: 0, embedding: [1, 2, 3] }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch) {
  return new OpenRouterClient({
    apiKey: "test-key",
    defaultCompletionModel: "default/model",
    defaultEmbeddingModel: "default/embed",
    fetchImpl,
  });
}

describe("OpenRouterClient", () => {
  it("honors the configured model and a per-call override (Gemma-is-one-line-away)", async () => {
    const calls: RecordedCall[] = [];
    const c = client(recordingFetch(calls));

    await c.complete({ prompt: "hi" });
    await c.complete({ prompt: "hi", model: "google/gemma-3-4b-it" });

    expect(calls[0]?.body.model).toBe("default/model");
    expect(calls[1]?.body.model).toBe("google/gemma-3-4b-it");
    expect(calls[0]?.auth).toBe("Bearer test-key");
  });

  it("builds messages from system + prompt and sets JSON response_format on request", async () => {
    const calls: RecordedCall[] = [];
    const c = client(recordingFetch(calls));

    await c.complete({ system: "You are terse.", prompt: "extract", json: true });

    expect(calls[0]?.body.messages).toEqual([
      { role: "system", content: "You are terse." },
      { role: "user", content: "extract" },
    ]);
    expect(calls[0]?.body.response_format).toEqual({ type: "json_object" });
  });

  it("returns embeddings in input order regardless of response order", async () => {
    const calls: RecordedCall[] = [];
    const c = client(recordingFetch(calls));

    const vecs = await c.embed(["a", "b"], "custom/embed");

    expect(calls[0]?.url).toMatch(/\/embeddings$/);
    expect(calls[0]?.body.model).toBe("custom/embed");
    expect(vecs).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("throws a clear error on a non-2xx response", async () => {
    const failing = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    await expect(client(failing).complete({ prompt: "hi" })).rejects.toThrow(/HTTP 429/);
  });

  it("createProvider throws a clear error when the API key is missing", () => {
    expect(() =>
      createProvider({
        databaseUrl: "x",
        extractionModel: "m",
        embeddingModel: "e",
        openrouterApiKey: undefined,
      }),
    ).toThrow(/OPENROUTER_API_KEY/);
  });
});

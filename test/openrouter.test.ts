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
    retryDelayMs: 0, // no real backoff sleeps in tests
  });
}

const okCompletion = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });

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

  it("retries a transient 429, then succeeds", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? new Response("rate limited", { status: 429 }) : okCompletion();
    }) as unknown as typeof fetch;

    const res = await client(fetchImpl).complete({ prompt: "hi" });
    expect(res.text).toBe("ok");
    expect(n).toBe(2); // one retry, then success
  });

  it("gives up after maxRetries on a persistent 429 (3 attempts)", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response("rate limited", { status: 429 });
    }) as unknown as typeof fetch;

    await expect(client(fetchImpl).complete({ prompt: "hi" })).rejects.toThrow(/HTTP 429/);
    expect(n).toBe(3); // initial attempt + 2 retries
  });

  it("does NOT retry a non-transient error (401 auth)", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    await expect(client(fetchImpl).complete({ prompt: "hi" })).rejects.toThrow(/HTTP 401/);
    expect(n).toBe(1); // failed fast, no retry
  });

  it("retries a network error (fetch throws), then succeeds", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) throw new Error("ECONNRESET");
      return okCompletion();
    }) as unknown as typeof fetch;

    const res = await client(fetchImpl).complete({ prompt: "hi" });
    expect(res.text).toBe("ok");
    expect(n).toBe(2); // retried the transport error
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

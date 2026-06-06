import { loadConfig, type Config } from "../config.js";
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ProviderClient,
} from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterOptions {
  apiKey: string;
  defaultCompletionModel: string;
  defaultEmbeddingModel: string;
  baseUrl?: string;
  /** Injectable for tests — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Thin OpenRouter (OpenAI-compatible) client for completions and embeddings.
 * Holds no prompt or extraction logic — just transport + model selection.
 */
export class OpenRouterClient implements ProviderClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly completionModel: string;
  private readonly embeddingModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenRouterOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.completionModel = opts.defaultCompletionModel;
    this.embeddingModel = opts.defaultEmbeddingModel;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = req.model ?? this.completionModel;
    const messages = toMessages(req);

    const body: Record<string, unknown> = { model, messages };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    if (req.json) body.response_format = { type: "json_object" };

    const json = await this.post("/chat/completions", body);
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new Error(`OpenRouter completion returned no text: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return { text, model };
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    if (texts.length === 0) return [];
    const useModel = model ?? this.embeddingModel;
    const json = await this.post("/embeddings", { model: useModel, input: texts });

    const data = json?.data;
    if (!Array.isArray(data)) {
      throw new Error(`OpenRouter embeddings returned no data: ${JSON.stringify(json).slice(0, 300)}`);
    }
    // Order by `index` defensively; the API may not return input order.
    return [...data]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding as number[]);
  }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${path} failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    return res.json();
  }
}

function toMessages(req: CompletionRequest): ChatMessage[] {
  if (req.messages) return req.messages;
  const messages: ChatMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  if (req.prompt) messages.push({ role: "user", content: req.prompt });
  if (messages.length === 0) {
    throw new Error("CompletionRequest needs `messages`, `prompt`, or `system`.");
  }
  return messages;
}

/**
 * Validate the provider config and build a client from it. Throws a clear,
 * actionable error when required settings are missing — called at startup so
 * misconfiguration fails fast rather than mid-request.
 */
export function createProvider(config: Config = loadConfig()): OpenRouterClient {
  if (!config.openrouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env (see .env.example) to use extraction, embeddings, or recall.",
    );
  }
  if (!config.extractionModel || !config.embeddingModel) {
    throw new Error(
      "TENSE_EXTRACTION_MODEL and TENSE_EMBEDDING_MODEL must be set (see .env.example).",
    );
  }
  return new OpenRouterClient({
    apiKey: config.openrouterApiKey,
    defaultCompletionModel: config.extractionModel,
    defaultEmbeddingModel: config.embeddingModel,
  });
}

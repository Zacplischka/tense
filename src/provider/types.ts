/**
 * Provider abstraction over an OpenAI-compatible gateway (OpenRouter). Kept
 * narrow and injectable so extraction/recall can be unit-tested without network
 * and so the model is swappable by configuration.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  /** Overrides the configured completion model when set. */
  model?: string;
  /** Convenience: a single user prompt (mutually exclusive with `messages`). */
  prompt?: string;
  system?: string;
  messages?: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Ask the model for a JSON object response (OpenAI `response_format`). */
  json?: boolean;
}

export interface CompletionResult {
  text: string;
  /** The model the request actually targeted. */
  model: string;
}

export interface ProviderClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Returns one embedding per input, in input order. */
  embed(texts: string[], model?: string): Promise<number[][]>;
}

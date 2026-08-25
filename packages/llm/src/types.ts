import type { ZodType } from "zod";

export const PROVIDERS = ["anthropic", "openai", "google", "openrouter", "ollama"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

/**
 * Tiers, not model IDs. Stages ask for a capability level and the router
 * resolves it per provider, so a new model release is a one-line edit to
 * models.json rather than a grep through the pipeline.
 */
export const TIERS = ["fast", "balanced", "frontier"] as const;
export type Tier = (typeof TIERS)[number];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelSpec {
  id: string;
  /** Newer Claude models reject temperature/top_p outright — see models.json. */
  sampling: boolean;
  thinking: "adaptive" | "none";
  effort: boolean;
  caching: boolean;
  contextTokens: number;
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

export interface CallOptions {
  tier: Tier;
  system?: string;
  /**
   * A long, byte-stable prefix shared across many calls — the dossier, in
   * practice. It is placed first and marked cacheable, which turns ten
   * expensive prefills during question generation into one.
   */
  cachedPrefix?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
  effort?: Effort;
  signal?: AbortSignal;
  /** Attributed on usage events so cost can be broken down per stage. */
  stage?: string;
}

export interface CallResult<T = string> {
  value: T;
  usage: Usage;
  model: string;
  provider: ProviderId;
}

export interface ObjectOptions<T> extends CallOptions {
  schema: ZodType<T>;
  schemaName: string;
  schemaDescription?: string;
}

export interface Provider {
  readonly id: ProviderId;
  text(options: CallOptions): Promise<CallResult<string>>;
  object<T>(options: ObjectOptions<T>): Promise<CallResult<T>>;
  /** Yields text deltas; returns final usage. */
  stream(options: CallOptions): AsyncGenerator<string, Usage, undefined>;
  embed(texts: string[]): Promise<CallResult<number[][]>>;
  /** Cheap round trip used to validate a key the moment it is pasted. */
  verify(): Promise<void>;
}

export interface ProviderCredentials {
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
}

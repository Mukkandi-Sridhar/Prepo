import Anthropic from "@anthropic-ai/sdk";
import { PrepoError } from "@prepo/shared";
import type {
  CallOptions,
  CallResult,
  ModelSpec,
  ObjectOptions,
  Provider,
  Usage,
} from "../types.js";
import { ZERO_USAGE } from "../types.js";
import { specFor } from "../router.js";

/**
 * Anthropic adapter, via the official SDK.
 */
export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey: string, baseUrl?: string) {
    if (!apiKey) throw new PrepoError("no_api_key", "No Anthropic API key configured.");
    this.client = new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
  }

  private buildParams(options: CallOptions, spec: ModelSpec): Record<string, unknown> {
    const system: Anthropic.TextBlockParam[] = [];

    if (options.cachedPrefix) {
      system.push({
        type: "text",
        text: options.cachedPrefix,
        ...(spec.caching ? { cache_control: { type: "ephemeral" as const } } : {}),
      });
    }
    if (options.system) {
      system.push({ type: "text", text: options.system });
    }

    const params: Record<string, unknown> = {
      model: spec.id,
      max_tokens: options.maxTokens ?? 16_000,
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (system.length > 0) params.system = system;
    if (spec.sampling && options.temperature !== undefined) params.temperature = options.temperature;
    if (spec.thinking === "adaptive") params.thinking = { type: "adaptive" };

    return params;
  }

  private usageOf(u: Anthropic.Usage | undefined): Usage {
    if (!u) return { ...ZERO_USAGE };
    return {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cachedTokens: (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    };
  }

  async text(options: CallOptions): Promise<CallResult<string>> {
    const spec = specFor("anthropic", options.tier);
    const params = this.buildParams(options, spec);

    const response = await this.client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      { signal: options.signal },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return { value: text, usage: this.usageOf(response.usage), model: spec.id, provider: this.id };
  }

  async object<T>(options: ObjectOptions<T>): Promise<CallResult<T>> {
    const spec = specFor("anthropic", options.tier);
    
    // Request JSON structured response using system prompt instruction
    const promptSystem = `${options.system ? options.system + "\n\n" : ""}Return ONLY a valid JSON object matching the ${options.schemaName} schema. Do not include markdown formatting outside the JSON output.`;
    const params = this.buildParams({ ...options, system: promptSystem }, spec);

    const response = await this.client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
      { signal: options.signal },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const cleanedText = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();

    try {
      const parsed = JSON.parse(cleanedText);
      return {
        value: options.schema.parse(parsed),
        usage: this.usageOf(response.usage),
        model: spec.id,
        provider: this.id,
      };
    } catch {
      throw new PrepoError("provider_error", `Model returned no parsable ${options.schemaName}. Raw output: ${text.slice(0, 200)}`);
    }
  }

  async *stream(options: CallOptions): AsyncGenerator<string, Usage, undefined> {
    const spec = specFor("anthropic", options.tier);
    const params = this.buildParams(options, spec);
    params.max_tokens = options.maxTokens ?? 64_000;

    const stream = this.client.messages.stream(
      params as unknown as Anthropic.MessageCreateParamsStreaming,
      { signal: options.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    return this.usageOf(final.usage);
  }

  async embed(): Promise<CallResult<number[][]>> {
    throw new PrepoError("provider_error", "Anthropic does not provide an embeddings endpoint.");
  }

  async verify(): Promise<void> {
    await this.client.messages.create({
      model: specFor("anthropic", "fast").id,
      max_tokens: 4,
      messages: [{ role: "user", content: "hi" }],
    });
  }
}

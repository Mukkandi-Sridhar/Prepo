import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { PrepoError } from "@prepo/shared";
import type {
  CallOptions,
  CallResult,
  ObjectOptions,
  Provider,
  ProviderId,
  Usage,
} from "../types.js";
import { ZERO_USAGE } from "../types.js";
import { specFor } from "../router.js";

/**
 * One adapter covers four providers, because OpenAI, OpenRouter, Google's
 * compatibility endpoint and Ollama all speak the same wire format. That is
 * four integrations for the price of one — and it means "add a provider" is
 * usually a one-line entry in DEFAULT_BASE_URLS rather than a new file.
 */

export const DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
};

/** Only these reliably honour a strict JSON schema; the rest get json_object + repair. */
const NATIVE_JSON_SCHEMA: ReadonlySet<ProviderId> = new Set<ProviderId>(["openai", "google"]);

export class OpenAiCompatibleProvider implements Provider {
  private client: OpenAI;

  constructor(
    readonly id: ProviderId,
    apiKey: string,
    baseUrl?: string,
  ) {
    const resolved = baseUrl ?? DEFAULT_BASE_URLS[id];
    if (id !== "ollama" && !apiKey) {
      throw new PrepoError("no_api_key", `No API key configured for ${id}.`);
    }
    this.client = new OpenAI({
      // Ollama ignores the key but the SDK insists on a non-empty string.
      apiKey: apiKey || "ollama",
      ...(resolved ? { baseURL: resolved } : {}),
    });
  }

  private messagesFor(options: CallOptions): OpenAI.Chat.ChatCompletionMessageParam[] {
    const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    const system = [options.cachedPrefix, options.system].filter(Boolean).join("\n\n");
    if (system) out.push({ role: "system", content: system });
    for (const m of options.messages) out.push({ role: m.role, content: m.content });
    return out;
  }

  private usageOf(u: OpenAI.CompletionUsage | undefined): Usage {
    if (!u) return { ...ZERO_USAGE };
    return {
      inputTokens: u.prompt_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  async text(options: CallOptions): Promise<CallResult<string>> {
    const spec = specFor(this.id, options.tier);
    const completion = await this.client.chat.completions.create(
      {
        model: spec.id,
        messages: this.messagesFor(options),
        max_tokens: options.maxTokens ?? 16_000,
        ...(spec.sampling && options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      },
      { signal: options.signal },
    );

    return {
      value: completion.choices[0]?.message?.content ?? "",
      usage: this.usageOf(completion.usage),
      model: spec.id,
      provider: this.id,
    };
  }

  async object<T>(options: ObjectOptions<T>): Promise<CallResult<T>> {
    const spec = specFor(this.id, options.tier);

    if (NATIVE_JSON_SCHEMA.has(this.id)) {
      try {
        const completion = await this.client.beta.chat.completions.parse(
          {
            model: spec.id,
            messages: this.messagesFor(options),
            max_tokens: options.maxTokens ?? 16_000,
            response_format: zodResponseFormat(options.schema as never, options.schemaName),
          },
          { signal: options.signal },
        );
        const parsed = completion.choices[0]?.message?.parsed;
        if (parsed) {
          return {
            value: options.schema.parse(parsed),
            usage: this.usageOf(completion.usage),
            model: spec.id,
            provider: this.id,
          };
        }
      } catch {
        // Endpoint rejected the schema (common on proxies that advertise
        // compatibility they don't have). Fall through to the repair path.
      }
    }

    return this.objectViaRepair(options, spec.id);
  }

  /**
   * The fallback for endpoints without real schema support: ask for JSON, then
   * validate locally and hand any Zod error straight back to the model. One
   * retry only — a model that cannot produce the shape twice will not produce
   * it on the third attempt either, and the caller has a budget to respect.
   */
  private async objectViaRepair<T>(options: ObjectOptions<T>, model: string): Promise<CallResult<T>> {
    const messages = this.messagesFor(options);
    const instruction = `Respond with a single JSON object matching this description: ${options.schemaDescription ?? options.schemaName}. Output JSON only — no prose, no markdown fences.`;
    messages.push({ role: "system", content: instruction });

    const usage: Usage = { ...ZERO_USAGE };
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await this.client.chat.completions.create(
        {
          model,
          messages,
          max_tokens: options.maxTokens ?? 16_000,
          response_format: { type: "json_object" },
        },
        { signal: options.signal },
      );

      const u = this.usageOf(completion.usage);
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      usage.cachedTokens += u.cachedTokens;

      const raw = completion.choices[0]?.message?.content ?? "";
      const result = options.schema.safeParse(extractJson(raw));

      if (result.success) {
        return { value: result.data, usage, model, provider: this.id };
      }

      lastError = result.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");

      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `That did not validate. Fix these problems and return the corrected JSON only:\n${lastError}`,
      });
    }

    throw new PrepoError(
      "provider_error",
      `${this.id} could not produce a valid ${options.schemaName}: ${lastError}`,
    );
  }

  async *stream(options: CallOptions): AsyncGenerator<string, Usage, undefined> {
    const spec = specFor(this.id, options.tier);
    const stream = await this.client.chat.completions.create(
      {
        model: spec.id,
        messages: this.messagesFor(options),
        max_tokens: options.maxTokens ?? 64_000,
        stream: true,
        stream_options: { include_usage: true },
        ...(spec.sampling && options.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
      },
      { signal: options.signal },
    );

    let usage: Usage = { ...ZERO_USAGE };
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
      if (chunk.usage) usage = this.usageOf(chunk.usage);
    }
    return usage;
  }

  async embed(texts: string[]): Promise<CallResult<number[][]>> {
    const model = process.env.EMBEDDING_MODEL || defaultEmbeddingModel(this.id);
    const response = await this.client.embeddings.create({ model, input: texts });

    return {
      value: response.data.map((d) => d.embedding),
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: 0,
        cachedTokens: 0,
      },
      model,
      provider: this.id,
    };
  }

  async verify(): Promise<void> {
    await this.client.chat.completions.create({
      model: specFor(this.id, "fast").id,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 4,
    });
  }
}

function defaultEmbeddingModel(id: ProviderId): string {
  switch (id) {
    case "ollama":
      return "nomic-embed-text";
    case "google":
      return "text-embedding-004";
    default:
      return "text-embedding-3-small";
  }
}

/** Models wrap JSON in fences even when told not to. Dig it out. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

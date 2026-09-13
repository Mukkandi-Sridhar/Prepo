import { PrepoError } from "@prepo/shared";
import { CostMeter } from "./cost.js";
import { createEmbedder, type Embedder } from "./embeddings.js";
import { createLazyProvider } from "./lazy-provider.js";
import { createProvider, specFor } from "./router.js";
import type { CallOptions, ObjectOptions, Provider, ProviderCredentials, Usage } from "./types.js";

export * from "./types.js";
export * from "./router.js";
export * from "./cost.js";
export * from "./embeddings.js";
export * from "./lazy-provider.js";
export { extractJson } from "./providers/openai-compatible.js";

/**
 * The single object every pipeline stage is handed. It owns three things the
 * stages should not each re-implement: budget enforcement, usage accounting,
 * and one structured-output repair retry.
 */
export class LlmClient {
  constructor(
    readonly provider: Provider,
    readonly meter: CostMeter,
    readonly embedder: Embedder,
  ) {}

  async text(options: CallOptions): Promise<string> {
    this.meter.assertWithinBudget();
    const result = await this.provider.text(options);
    this.meter.record(result, options.stage ?? "unknown");
    return result.value;
  }

  async object<T>(options: ObjectOptions<T>): Promise<T> {
    this.meter.assertWithinBudget();
    try {
      const result = await this.provider.object(options);
      this.meter.record(result, options.stage ?? "unknown");
      return result.value;
    } catch (err) {
      if (!(err instanceof PrepoError) || err.code !== "provider_error") throw err;

      // One repair attempt with the failure spelled out. Beyond that the model
      // is not going to find the shape, and the budget deserves better.
      this.meter.assertWithinBudget();
      const retry = await this.provider.object({
        ...options,
        messages: [
          ...options.messages,
          {
            role: "user",
            content: `The previous attempt did not produce a valid ${options.schemaName}: ${err.message}\nReturn only a correctly shaped ${options.schemaName}.`,
          },
        ],
      });
      this.meter.record(retry, `${options.stage ?? "unknown"}:repair`);
      return retry.value;
    }
  }

  async *stream(options: CallOptions): AsyncGenerator<string, Usage, undefined> {
    this.meter.assertWithinBudget();
    const iterator = this.provider.stream(options);

    let next = await iterator.next();
    while (!next.done) {
      yield next.value;
      next = await iterator.next();
    }

    const usage = next.value;
    this.meter.record(
      { value: "", usage, model: specFor(this.provider.id, options.tier).id, provider: this.provider.id },
      options.stage ?? "stream",
    );
    return usage;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.embedder.embed(texts);
  }
}

export function createLlmClient(
  credentials: ProviderCredentials,
  meter: CostMeter,
  embedder: Embedder = createEmbedder(),
): LlmClient {
  return new LlmClient(createProvider(credentials), meter, embedder);
}

/**
 * Same shape as `createLlmClient`, but credential resolution is deferred to
 * the first real call. Use this for batch/background work — like the
 * analysis pipeline — where the caller wants stages that don't need an LLM
 * to run to completion even when no provider is configured yet, and wants
 * the "no key" error to surface naturally, as a normal rejection, at the
 * point something actually needs one — see `lazy-provider.ts`.
 *
 * Not what you want for an interactive request (a chat turn, a "verify this
 * key" click) — there, resolving eagerly and failing immediately is the
 * correct UX, so use `createLlmClient` instead.
 */
export function createLazyLlmClient(
  resolveCredentials: () => Promise<ProviderCredentials>,
  meter: CostMeter,
  embedder: Embedder = createEmbedder(),
): LlmClient {
  return new LlmClient(
    createLazyProvider(() => resolveCredentials().then(createProvider)),
    meter,
    embedder,
  );
}

export { CostMeter };

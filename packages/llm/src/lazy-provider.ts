import type { CallOptions, CallResult, ObjectOptions, Provider, ProviderId, Usage } from "./types.js";

/**
 * Wraps a `Provider` behind deferred resolution.
 *
 * The worker builds its `PipelineContext` once per job and hands it straight
 * to `runPipeline`, but stages 01–03 (acquire, filter, extract facts) never
 * touch `ctx.llm` at all — they're deterministic and free by design, which is
 * the whole point of the Repo Card working before anyone has pasted an API
 * key. Resolving credentials *before* those stages run means a fresh
 * install with no key configured yet fails before stage 01 even starts,
 * instead of after stage 03 persists the facts a user was promised.
 *
 * This defers `resolveCredentials` (and the real provider construction) to
 * the first genuine call — `text`, `object`, `stream`, or `embed` — so a
 * missing key surfaces exactly where it starts to matter, as a normal,
 * catchable error inside whichever stage actually needed it.
 */
export class LazyProvider implements Provider {
  private resolved: Promise<Provider> | null = null;
  private resolvedId: ProviderId | null = null;

  constructor(private readonly resolveProvider: () => Promise<Provider>) {}

  /**
   * Only meaningful after the first real call. Every place in this codebase
   * that reads `.id` does so after already awaiting a `text`/`object`/
   * `stream`/`embed` call on the same client, so this placeholder is never
   * actually observed — it exists so the type stays a plain string, not
   * `string | null`, for the handful of call sites that read it.
   */
  get id(): ProviderId {
    return this.resolvedId ?? "anthropic";
  }

  private get(): Promise<Provider> {
    if (!this.resolved) {
      this.resolved = this.resolveProvider().then((provider) => {
        this.resolvedId = provider.id;
        return provider;
      });
    }
    return this.resolved;
  }

  async text(options: CallOptions): Promise<CallResult<string>> {
    const provider = await this.get();
    return provider.text(options);
  }

  async object<T>(options: ObjectOptions<T>): Promise<CallResult<T>> {
    const provider = await this.get();
    return provider.object(options);
  }

  async *stream(options: CallOptions): AsyncGenerator<string, Usage, undefined> {
    const provider = await this.get();
    return yield* provider.stream(options);
  }

  async embed(texts: string[]): Promise<CallResult<number[][]>> {
    const provider = await this.get();
    return provider.embed(texts);
  }

  async verify(): Promise<void> {
    const provider = await this.get();
    return provider.verify();
  }
}

export function createLazyProvider(resolveProvider: () => Promise<Provider>): Provider {
  return new LazyProvider(resolveProvider);
}

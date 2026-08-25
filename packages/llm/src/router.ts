import { PrepoError } from "@prepo/shared";
import modelsJson from "./models.json" with { type: "json" };
import type { ModelSpec, Provider, ProviderCredentials, ProviderId, Tier } from "./types.js";
import { PROVIDERS } from "./types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";

const models = modelsJson as unknown as Record<ProviderId, Record<Tier, ModelSpec>>;

const TIER_ENV: Record<Tier, string> = {
  fast: "MODEL_FAST",
  balanced: "MODEL_BALANCED",
  frontier: "MODEL_FRONTIER",
};

/**
 * Resolve a tier to a concrete model. An operator override in .env wins, but
 * only over the model id — the capability flags still come from models.json,
 * because those describe what the *API* accepts, not what the operator wants.
 */
export function specFor(provider: ProviderId, tier: Tier): ModelSpec {
  const spec = models[provider]?.[tier];
  if (!spec) throw new PrepoError("invalid_input", `No ${tier} model configured for ${provider}.`);

  const override = process.env[TIER_ENV[tier]];
  return override ? { ...spec, id: override } : spec;
}

export function allTiers(provider: ProviderId): Record<Tier, ModelSpec> {
  return {
    fast: specFor(provider, "fast"),
    balanced: specFor(provider, "balanced"),
    frontier: specFor(provider, "frontier"),
  };
}

export function createProvider(creds: ProviderCredentials): Provider {
  switch (creds.provider) {
    case "anthropic":
      return new AnthropicProvider(creds.apiKey ?? "", creds.baseUrl);
    case "openai":
    case "google":
    case "openrouter":
    case "ollama":
      return new OpenAiCompatibleProvider(creds.provider, creds.apiKey ?? "", creds.baseUrl);
    default:
      throw new PrepoError("invalid_input", `Unknown provider: ${creds.provider}`);
  }
}

/** Environment-level credentials. User-supplied keys are layered on top of these. */
export function credentialsFromEnv(provider: ProviderId): ProviderCredentials | null {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY
        ? { provider, apiKey: process.env.ANTHROPIC_API_KEY }
        : null;
    case "openai":
      return process.env.OPENAI_API_KEY ? { provider, apiKey: process.env.OPENAI_API_KEY } : null;
    case "google":
      return process.env.GOOGLE_API_KEY ? { provider, apiKey: process.env.GOOGLE_API_KEY } : null;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY
        ? { provider, apiKey: process.env.OPENROUTER_API_KEY }
        : null;
    case "ollama":
      return process.env.OLLAMA_BASE_URL
        ? { provider, apiKey: "", baseUrl: `${process.env.OLLAMA_BASE_URL.replace(/\/+$/, "")}/v1` }
        : null;
    default:
      return null;
  }
}

export function providersAvailableFromEnv(): ProviderId[] {
  return PROVIDERS.filter((p) => credentialsFromEnv(p) !== null);
}

export function defaultProvider(): ProviderId {
  const preferred = process.env.DEFAULT_PROVIDER as ProviderId | undefined;
  const available = providersAvailableFromEnv();
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] ?? preferred ?? "anthropic";
}

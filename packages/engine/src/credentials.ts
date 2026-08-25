import { and, eq, providerKeys, type Db } from "@prepo/db";
import { open, PrepoError } from "@prepo/shared";
import {
  credentialsFromEnv,
  defaultProvider,
  PROVIDERS,
  type ProviderCredentials,
  type ProviderId,
} from "@prepo/llm";

export interface ResolvedKey extends ProviderCredentials {
  source: "user" | "env";
  last4: string;
}

/**
 * Key precedence: a key the user pasted in Settings always beats one in the
 * environment. That ordering matters for the shared-demo case — the operator's
 * key is the floor, not the ceiling.
 *
 * Ephemeral keys are never in the database by design, so they arrive from the
 * request instead; see `withEphemeralKey`.
 */
export async function resolveCredentials(
  db: Db,
  userId: string,
  preferred?: ProviderId,
): Promise<ResolvedKey> {
  const wanted = preferred ?? defaultProvider();
  const order: ProviderId[] = [wanted, ...PROVIDERS.filter((p) => p !== wanted)];

  for (const provider of order) {
    const row = await db.query.providerKeys.findFirst({
      where: and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)),
    });

    if (row?.mode === "stored" && row.ciphertext && row.iv && row.authTag) {
      return {
        provider,
        apiKey: open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }, userId),
        source: "user",
        last4: row.last4,
      };
    }

    const fromEnv = credentialsFromEnv(provider);
    if (fromEnv) {
      return { ...fromEnv, source: "env", last4: (fromEnv.apiKey ?? "").slice(-4) || "—" };
    }
  }

  throw new PrepoError(
    "no_api_key",
    "No model provider is configured. Add your API key in Settings, or point OLLAMA_BASE_URL at a local model.",
  );
}

/** Which providers this user could use right now, for the Settings UI. */
export async function availableProviders(
  db: Db,
  userId: string,
): Promise<Array<{ provider: ProviderId; source: "user" | "env"; last4: string }>> {
  const rows = await db.query.providerKeys.findMany({ where: eq(providerKeys.userId, userId) });
  const out: Array<{ provider: ProviderId; source: "user" | "env"; last4: string }> = [];

  for (const provider of PROVIDERS) {
    const row = rows.find((r) => r.provider === provider);
    if (row?.mode === "stored" && row.ciphertext) {
      out.push({ provider, source: "user", last4: row.last4 });
      continue;
    }
    if (credentialsFromEnv(provider)) {
      out.push({ provider, source: "env", last4: "env" });
    }
  }
  return out;
}

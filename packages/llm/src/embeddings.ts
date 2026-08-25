import { EMBEDDING_DIM } from "@prepo/shared";
import type { ProviderId } from "./types.js";
import { createProvider, credentialsFromEnv } from "./router.js";

export interface Embedder {
  readonly id: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Chunks are stored in a fixed-width column, but embedding models disagree on
 * dimension (1536 for text-embedding-3-small, 768 for nomic-embed-text).
 * Rather than making the migration depend on a runtime setting, vectors are
 * fitted to EMBEDDING_DIM and renormalised. Padding is lossless; truncation
 * loses the tail dimensions, which for retrieval at this scale is acceptable.
 */
export function fitDimension(vector: number[], dim = EMBEDDING_DIM): number[] {
  const out = vector.length === dim ? [...vector] : new Array<number>(dim).fill(0);
  if (vector.length !== dim) {
    for (let i = 0; i < Math.min(vector.length, dim); i++) out[i] = vector[i]!;
  }
  return normalize(out);
}

function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / norm;
  return v;
}

class ApiEmbedder implements Embedder {
  constructor(
    readonly id: string,
    private readonly provider: ProviderId,
    private readonly apiKey: string,
    private readonly baseUrl?: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const client = createProvider({ provider: this.provider, apiKey: this.apiKey, baseUrl: this.baseUrl });
    const out: number[][] = [];

    // Batched to keep request bodies well under provider payload limits.
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64);
      const result = await client.embed(batch);
      for (const vector of result.value) out.push(fitDimension(vector));
    }
    return out;
  }
}

/**
 * A dependency-free lexical embedder: hashed token and bigram counts projected
 * into the same vector space, L2-normalised.
 *
 * It is genuinely worse than a real embedding model — it matches vocabulary,
 * not meaning. It exists so that `docker compose up` produces a working
 * application with no cloud account and no model download, and the UI says
 * plainly when it is in use.
 */
export class LocalHashEmbedder implements Embedder {
  readonly id = "local-hash";

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.one(t)));
  }

  private one(text: string): number[] {
    const vector = new Array<number>(EMBEDDING_DIM).fill(0);
    const tokens = text.toLowerCase().match(/[a-z_][a-z0-9_]{1,}|\d+/g) ?? [];

    const add = (term: string, weight: number) => {
      const h = fnv1a(term);
      const index = h % EMBEDDING_DIM;
      // Sign from a second hash bit keeps unrelated terms from all pushing
      // the vector in the same direction.
      vector[index] = (vector[index] ?? 0) + (h & 0x10000 ? 1 : -1) * weight;
    };

    for (let i = 0; i < tokens.length; i++) {
      add(tokens[i]!, 1);
      if (i > 0) add(`${tokens[i - 1]}~${tokens[i]}`, 0.6);
    }

    // Sub-linear term weighting, the same reason tf-idf uses a log.
    for (let i = 0; i < vector.length; i++) {
      const x = vector[i]!;
      vector[i] = Math.sign(x) * Math.log1p(Math.abs(x));
    }
    return normalize(vector);
  }
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function createEmbedder(): Embedder {
  const configured = (process.env.EMBEDDING_PROVIDER ?? "auto").toLowerCase();

  const tryProvider = (id: ProviderId): Embedder | null => {
    const creds = credentialsFromEnv(id);
    if (!creds) return null;
    return new ApiEmbedder(`${id}:${process.env.EMBEDDING_MODEL || "default"}`, id, creds.apiKey ?? "", creds.baseUrl);
  };

  if (configured === "local") return new LocalHashEmbedder();
  if (configured !== "auto") {
    return tryProvider(configured as ProviderId) ?? new LocalHashEmbedder();
  }

  // Ollama first: if someone runs a local model, they almost certainly prefer
  // embeddings to stay local too.
  return tryProvider("ollama") ?? tryProvider("openai") ?? tryProvider("google") ?? new LocalHashEmbedder();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are already normalised
}

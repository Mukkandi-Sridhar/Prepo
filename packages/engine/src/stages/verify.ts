import { critic as criticPrompt } from "@prepo/prompts";
import {
  CriticVerdict,
  type Citation,
  type GeneratedQuestion,
  type Persona,
  type ProjectDossier,
  type RepoFacts,
} from "@prepo/shared";
import { cosineSimilarity } from "@prepo/llm";
import type { PipelineContext } from "../context.js";
import { citationSource } from "../retrieval.js";
import { chunkArray, mapLimitSettled } from "../util.js";

export interface VerifiedOutput {
  questions: Array<GeneratedQuestion & { persona: Persona; groundedness: number; rank: number }>;
  dropped: {
    unresolvedCitations: number;
    unsupported: number;
    duplicates: number;
  };
}

const CRITIC_CONCURRENCY = 6;
const DUPLICATE_THRESHOLD = 0.9;
const MIN_GROUNDEDNESS = 0.5;

/**
 * Stage 07 — the gate that makes the whole product trustworthy.
 *
 * Three filters in increasing order of cost, so the cheap ones run first:
 *
 *  1. Do the cited line ranges exist? Pure SQL, no model, no tokens. A
 *     question whose citations are invented dies here for free.
 *  2. Does the code at those lines support the claims? One critic call in a
 *     *fresh context* — it never sees the generator's reasoning, because a
 *     model shown its own working will usually agree with it.
 *  3. Is this a near-duplicate of a better question? Embedding cosine.
 *
 * Cite or drop. A confidently wrong answer repeated in a real interview is the
 * worst thing this product could produce, and it is worth throwing away good
 * questions to be sure of avoiding it.
 */
export async function verifyQuestions(
  ctx: PipelineContext,
  input: {
    snapshotId: string;
    facts: RepoFacts;
    dossier: ProjectDossier;
    questions: Array<GeneratedQuestion & { persona: Persona }>;
    resumeClaims?: string[];
  },
): Promise<VerifiedOutput> {
  const dropped = { unresolvedCitations: 0, unsupported: 0, duplicates: 0 };

  /* ── 1. resolve citations (free) ─────────────────────────── */

  const withEvidence: Array<{
    question: GeneratedQuestion & { persona: Persona };
    citations: Citation[];
    resolved: Array<{ path: string; startLine: number; endLine: number; content: string }>;
  }> = [];

  for (const question of input.questions) {
    const resolved: Array<{ path: string; startLine: number; endLine: number; content: string }> = [];
    const kept: Citation[] = [];

    for (const citation of question.citations.slice(0, 6)) {
      const source = await citationSource(
        input.snapshotId,
        citation.path,
        citation.startLine,
        citation.endLine,
      );
      if (source) {
        kept.push(citation);
        resolved.push(source);
      }
    }

    if (kept.length === 0) {
      dropped.unresolvedCitations++;
      continue;
    }
    withEvidence.push({ question, citations: kept, resolved });
  }

  await ctx.onProgress("verify", 0.15, `${withEvidence.length} questions have real citations`);

  /* ── 2. critic pass ──────────────────────────────────────── */

  let checked = 0;
  const verdicts = await mapLimitSettled(withEvidence, CRITIC_CONCURRENCY, async (item) => {
    ctx.signal?.throwIfAborted();

    const verdict = await ctx.llm.object({
      tier: "balanced",
      stage: "07-critic",
      temperature: 0.1,
      system: criticPrompt.system,
      messages: [
        {
          role: "user",
          content: criticPrompt.user({ question: item.question, resolved: item.resolved }),
        },
      ],
      schema: CriticVerdict,
      schemaName: "CriticVerdict",
      schemaDescription: "Whether an interview answer is supported by the code it cites",
      maxTokens: 4_000,
      signal: ctx.signal,
    });

    checked++;
    if (checked % 4 === 0 || checked === withEvidence.length) {
      await ctx.onProgress(
        "verify",
        0.15 + (checked / Math.max(1, withEvidence.length)) * 0.65,
        `Checked ${checked}/${withEvidence.length} answers against the code`,
      );
    }

    return { ...item, verdict };
  });

  const survivors: Array<GeneratedQuestion & { persona: Persona; groundedness: number; rank: number }> = [];

  for (const result of verdicts) {
    if (!result.ok) continue;
    const { question, citations, verdict } = result.value;

    if (verdict.groundedness < MIN_GROUNDEDNESS || (!verdict.supported && !verdict.correctedAnswer)) {
      dropped.unsupported++;
      continue;
    }

    survivors.push({
      ...question,
      citations,
      modelAnswer: verdict.correctedAnswer ?? question.modelAnswer,
      groundedness: verdict.groundedness,
      rank: 0,
    });
  }

  /* ── 3. dedupe ───────────────────────────────────────────── */

  const deduped = await dedupe(ctx, survivors);
  dropped.duplicates = survivors.length - deduped.length;

  /* ── 4. rank ─────────────────────────────────────────────── */

  const ranked = rank(deduped, input.dossier, input.facts, input.resumeClaims ?? []);
  await ctx.onProgress("verify", 1, `${ranked.length} questions survived verification`);

  return { questions: ranked, dropped };
}

async function dedupe<T extends { stem: string; groundedness: number }>(
  ctx: PipelineContext,
  questions: T[],
): Promise<T[]> {
  if (questions.length < 2) return questions;

  const vectors: number[][] = [];
  for (const batch of chunkArray(questions.map((q) => q.stem), 64)) {
    vectors.push(...(await ctx.llm.embed(batch)));
  }

  // Highest groundedness first, so when two questions collide the better
  // evidenced one is the survivor.
  const order = questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => b.q.groundedness - a.q.groundedness);

  const kept: Array<{ q: T; vector: number[] }> = [];
  for (const { q, i } of order) {
    const vector = vectors[i];
    if (!vector) {
      kept.push({ q, vector: [] });
      continue;
    }
    const isDuplicate = kept.some(
      (k) => k.vector.length > 0 && cosineSimilarity(k.vector, vector) > DUPLICATE_THRESHOLD,
    );
    if (!isDuplicate) kept.push({ q, vector });
  }

  return kept.map((k) => k.q);
}

/**
 * Expected-value ranking. The user sees the top 40 first, so this decides what
 * the product feels like more than any other forty lines in the codebase.
 */
function rank<T extends GeneratedQuestion & { groundedness: number; rank: number }>(
  questions: T[],
  dossier: ProjectDossier,
  facts: RepoFacts,
  resumeClaims: string[],
): T[] {
  const hotspotPaths = new Set(dossier.hotspots.flatMap((h) => h.paths));
  const churnPaths = new Set(facts.git.hotspots.slice(0, 10).map((h) => h.path));
  const claimTerms = resumeClaims
    .join(" ")
    .toLowerCase()
    .match(/[a-z][a-z0-9+#.]{2,}/g) ?? [];

  const difficultyBonus: Record<string, number> = { L1: 0, L2: 0.1, L3: 0.18 };

  for (const question of questions) {
    const paths = question.citations.map((c) => c.path);
    let score = question.groundedness;

    // A question about code the dossier flagged as interesting is, by
    // construction, a question worth asking.
    if (paths.some((p) => hotspotPaths.has(p))) score += 0.3;
    if (paths.some((p) => churnPaths.has(p))) score += 0.12;
    score += difficultyBonus[question.difficulty] ?? 0;

    if (claimTerms.length > 0) {
      const haystack = `${question.stem} ${paths.join(" ")}`.toLowerCase();
      const hits = new Set(claimTerms.filter((t) => haystack.includes(t))).size;
      score += Math.min(0.25, hits * 0.05);
    }

    // A question citing several files is usually asking something integrative.
    score += Math.min(0.08, (new Set(paths).size - 1) * 0.04);

    question.rank = Number(score.toFixed(4));
  }

  return questions.sort((a, b) => b.rank - a.rank);
}

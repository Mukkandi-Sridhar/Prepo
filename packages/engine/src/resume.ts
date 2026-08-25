import { resume as resumePrompt } from "@prepo/prompts";
import { z } from "zod";
import { ClaimCheck, ResumeAnalysis, type RepoFacts, type ResumeClaim } from "@prepo/shared";
import type { PipelineContext } from "./context.js";
import { retrieve } from "./retrieval.js";

const ChecksSchema = z.object({ checks: z.array(ClaimCheck) });

export async function extractClaims(
  ctx: PipelineContext,
  input: { resumeText: string; projectName: string },
): Promise<ResumeAnalysis> {
  return ctx.llm.object({
    tier: "balanced",
    stage: "resume-extract",
    system: resumePrompt.extractSystem,
    messages: [{ role: "user", content: resumePrompt.extractUser(input) }],
    schema: ResumeAnalysis,
    schemaName: "ResumeAnalysis",
    schemaDescription: "Claims the candidate makes about this project on their resume",
    maxTokens: 6_000,
    signal: ctx.signal,
  });
}

/**
 * The uncomfortable half of resume tailoring, and the reason it earns its
 * place: finding out here that the repo contains no Redis is a much better
 * afternoon than finding out in the interview.
 */
export async function checkClaims(
  ctx: PipelineContext,
  input: { snapshotId: string; claims: ResumeClaim[]; facts: RepoFacts },
): Promise<ClaimCheck[]> {
  if (input.claims.length === 0) return [];

  // One retrieval pass over every claim's keywords, so the checker sees the
  // code that would support them if it existed.
  const query = input.claims.flatMap((c) => c.keywords).join(" ").slice(0, 400);
  const chunks = await retrieve(ctx, input.snapshotId, query, 14);

  const evidence = chunks
    .map((c) => `### ${c.path} (${c.startLine}–${c.endLine})\n${c.content}`)
    .join("\n\n");

  const result = await ctx.llm.object({
    tier: "balanced",
    stage: "resume-check",
    system: resumePrompt.checkSystem,
    messages: [
      { role: "user", content: resumePrompt.checkUser({ claims: input.claims, facts: input.facts, evidence }) },
    ],
    schema: ChecksSchema,
    schemaName: "ClaimChecks",
    schemaDescription: "Whether each resume claim is supported by the repository",
    maxTokens: 8_000,
    signal: ctx.signal,
  });

  return result.checks;
}

/** Rough stack weights from a job description, used by the stage-07 ranker. */
export function stackWeightsFromJd(jdText: string, facts: RepoFacts): Record<string, number> {
  const vocabulary = new Set(
    [
      ...facts.frameworks,
      ...facts.languages.map((l) => l.lang),
      ...facts.dependencies.slice(0, 120).map((d) => d.name),
    ].map((t) => t.toLowerCase()),
  );

  const text = jdText.toLowerCase();
  const weights: Record<string, number> = {};

  for (const term of vocabulary) {
    if (term.length < 3) continue;
    const occurrences = text.split(term).length - 1;
    if (occurrences > 0) weights[term] = Math.min(1, 0.3 + occurrences * 0.2);
  }
  return weights;
}

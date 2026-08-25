import { interviewer, scorer } from "@prepo/prompts";
import {
  Evaluation,
  InterviewPlan,
  InterviewerTurn,
  MODE_CONFIG,
  type InterviewMode,
  type ProjectDossier,
} from "@prepo/shared";
import type { PipelineContext } from "./context.js";
import { retrieve } from "./retrieval.js";

export interface Transcript {
  role: "interviewer" | "candidate";
  content: string;
}

/**
 * Builds the interviewer's private plan once, at session start. Having a plan
 * is what separates a mock interview from a pleasant conversation that never
 * tests anything — the agent always knows which beat it is on and how much
 * time is left for it.
 */
export async function planInterview(
  ctx: PipelineContext,
  input: { dossier: ProjectDossier; mode: InterviewMode; projectName: string },
): Promise<InterviewPlan> {
  return ctx.llm.object({
    tier: "balanced",
    stage: "interview-plan",
    system: interviewer.planSystem,
    messages: [{ role: "user", content: interviewer.planUser(input) }],
    schema: InterviewPlan,
    schemaName: "InterviewPlan",
    schemaDescription: "The beats an interviewer will cover and the opening line",
    maxTokens: 4_000,
    signal: ctx.signal,
  });
}

/**
 * One interviewer turn.
 *
 * Structured first (which move, which beat), then streamed — so the UI can
 * show "digging deeper…" while the sentence is still arriving. Splitting it
 * this way costs one extra small call per turn and buys a mock interview that
 * feels like it is thinking rather than buffering.
 */
export async function nextTurn(
  ctx: PipelineContext,
  input: {
    snapshotId: string;
    plan: InterviewPlan;
    transcript: Transcript[];
    mode: InterviewMode;
  },
): Promise<InterviewerTurn> {
  const exchanges = input.transcript.filter((t) => t.role === "candidate").length;
  const turnsRemaining = Math.max(0, MODE_CONFIG[input.mode].turns - exchanges);

  const beatIndex = Math.min(
    Math.floor((exchanges / Math.max(1, MODE_CONFIG[input.mode].turns)) * input.plan.beats.length),
    input.plan.beats.length - 1,
  );
  const beat = input.plan.beats[beatIndex];

  const chunks = beat
    ? await retrieve(ctx, input.snapshotId, `${beat.hotspot} ${beat.goal}`, 6)
    : [];

  const beatEvidence = chunks
    .map((c) => `### ${c.path} (${c.startLine}–${c.endLine})\n${c.content}`)
    .join("\n\n");

  const turn = await ctx.llm.object({
    tier: "balanced",
    stage: "interview-turn",
    system: interviewer.turnSystem,
    messages: [
      {
        role: "user",
        content: interviewer.turnUser({
          plan: input.plan,
          transcript: input.transcript,
          turnsRemaining,
          beatEvidence,
        }),
      },
    ],
    schema: InterviewerTurn,
    schemaName: "InterviewerTurn",
    schemaDescription: "The interviewer's next move and what they say",
    maxTokens: 2_000,
    signal: ctx.signal,
  });

  // The model is asked to wrap when turns run out, but the countdown is ours
  // to enforce — a session that will not end is a bad experience.
  if (turnsRemaining <= 0) return { ...turn, move: "wrap", note: turn.note ?? "" };
  return { ...turn, beatIndex, note: turn.note ?? "" };
}

export async function scoreInterview(
  ctx: PipelineContext,
  input: { plan: InterviewPlan; transcript: Transcript[]; projectName: string },
): Promise<Evaluation> {
  return ctx.llm.object({
    tier: "balanced",
    stage: "interview-score",
    effort: "high",
    system: scorer.system,
    messages: [{ role: "user", content: scorer.user(input) }],
    schema: Evaluation,
    schemaName: "Evaluation",
    schemaDescription: "Rubric scores, weak areas and next steps for a mock interview",
    maxTokens: 6_000,
    signal: ctx.signal,
  });
}

import { z } from "zod";
import { Difficulty, Persona } from "./question.js";

export const InterviewMode = z.enum(["quick", "standard", "deep"]);
export type InterviewMode = z.infer<typeof InterviewMode>;

export const MODE_CONFIG: Record<InterviewMode, { turns: number; label: string; blurb: string }> = {
  quick: { turns: 6, label: "Quick", blurb: "~5 min · three hotspots" },
  standard: { turns: 14, label: "Standard", blurb: "~15 min · full walkthrough" },
  deep: { turns: 24, label: "Deep", blurb: "~30 min · bar-raiser pressure" },
};

/** The interviewer's private plan, built once at session start from the dossier. */
export const InterviewPlan = z.object({
  persona: Persona,
  difficulty: Difficulty,
  opening: z.string(),
  beats: z.array(
    z.object({
      hotspot: z.string(),
      goal: z.string(),
      maxTurns: z.number().int(),
    }),
  ),
});
export type InterviewPlan = z.infer<typeof InterviewPlan>;

/**
 * Each turn the interviewer decides what to do next. Making this an explicit
 * enum rather than letting the model free-form keeps the session from
 * wandering, and gives the UI something to show ("digging deeper…").
 */
export const InterviewMove = z.enum(["probe", "advance", "challenge", "wrap"]);
export type InterviewMove = z.infer<typeof InterviewMove>;

export const InterviewerTurn = z.object({
  move: InterviewMove,
  say: z.string(),
  /** Private note carried forward; never shown mid-session. */
  note: z.string().default(""),
  beatIndex: z.number().int().min(0),
});
export type InterviewerTurn = z.infer<typeof InterviewerTurn>;

export const RUBRIC_DIMENSIONS = [
  "technical-depth",
  "clarity",
  "ownership",
  "tradeoff-awareness",
  "honesty",
] as const;
export const RubricDimension = z.enum(RUBRIC_DIMENSIONS);
export type RubricDimension = z.infer<typeof RubricDimension>;

export const RUBRIC_LABELS: Record<RubricDimension, string> = {
  "technical-depth": "Technical depth",
  clarity: "Clarity",
  ownership: "Ownership",
  "tradeoff-awareness": "Trade-off awareness",
  honesty: "Honesty about limits",
};

export const Evaluation = z.object({
  overall: z.number().min(0).max(5),
  headline: z.string(),
  scores: z.array(
    z.object({
      dimension: RubricDimension,
      score: z.number().min(0).max(5),
      evidence: z.string(),
      improve: z.string(),
    }),
  ),
  weakAreas: z.array(z.string()),
  strongAreas: z.array(z.string()),
  nextSteps: z.array(z.string()).max(5),
});
export type Evaluation = z.infer<typeof Evaluation>;

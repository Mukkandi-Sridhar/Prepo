import { z } from "zod";

export const QUESTION_CATEGORIES = [
  "walkthrough",
  "architecture",
  "language",
  "data-modeling",
  "api-design",
  "performance",
  "security",
  "testing",
  "devops",
  "debugging",
  "scaling",
  "tradeoffs",
  "behavioral",
] as const;
export const QuestionCategory = z.enum(QUESTION_CATEGORIES);
export type QuestionCategory = z.infer<typeof QuestionCategory>;

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  walkthrough: "Project walkthrough",
  architecture: "Architecture",
  language: "Language & framework",
  "data-modeling": "Data modeling",
  "api-design": "API design",
  performance: "Concurrency & performance",
  security: "Security",
  testing: "Testing",
  devops: "DevOps & deployment",
  debugging: "Debugging & incidents",
  scaling: "Scaling it up",
  tradeoffs: "Trade-offs",
  behavioral: "Behavioral (STAR)",
};

export const Difficulty = z.enum(["L1", "L2", "L3"]);
export type Difficulty = z.infer<typeof Difficulty>;

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  L1: "Screening",
  L2: "Mid-level",
  L3: "Senior / staff",
};

export const PERSONAS = ["hiring-manager", "tech-lead", "peer", "bar-raiser"] as const;
export const Persona = z.enum(PERSONAS);
export type Persona = z.infer<typeof Persona>;

/**
 * A citation is a claim of evidence, and it is checked. Stage 07 resolves
 * every one of these against the real file at the real commit before the
 * question is allowed anywhere near a user.
 */
export const Citation = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbol: z.string().nullable().default(null),
});
export type Citation = z.infer<typeof Citation>;

export const StarFrame = z.object({
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string(),
});
export type StarFrame = z.infer<typeof StarFrame>;

/** What the generator model is asked to produce. */
export const GeneratedQuestion = z.object({
  stem: z.string(),
  category: QuestionCategory,
  difficulty: Difficulty,
  testingFor: z.string(),
  modelAnswer: z.string(),
  probes: z.array(z.string()).max(5),
  redFlags: z.array(z.string()).max(4).default([]),
  citations: z.array(Citation).min(1),
  starFrame: StarFrame.nullable().default(null),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestion>;

/** What survives stage 07 and gets persisted. */
export const VerifiedQuestion = GeneratedQuestion.extend({
  id: z.string(),
  persona: Persona,
  groundedness: z.number().min(0).max(1),
  rank: z.number(),
});
export type VerifiedQuestion = z.infer<typeof VerifiedQuestion>;

/** Stage 07's critic verdict for a single question. */
export const CriticVerdict = z.object({
  supported: z.boolean(),
  groundedness: z.number().min(0).max(1),
  unsupportedClaims: z.array(z.string()).default([]),
  correctedAnswer: z.string().nullable().default(null),
  reason: z.string(),
});
export type CriticVerdict = z.infer<typeof CriticVerdict>;

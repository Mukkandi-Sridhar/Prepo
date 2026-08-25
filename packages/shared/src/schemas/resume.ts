import { z } from "zod";

/**
 * Resume claims are extracted so the ranker can weight questions toward what
 * the candidate actually wrote down — and so we can warn them when the repo
 * does not support a claim. That warning is uncomfortable and genuinely useful.
 */
export const ResumeClaim = z.object({
  claim: z.string(),
  kind: z.enum(["technology", "scale", "impact", "role", "outcome"]),
  /** Terms to match against the repo's own vocabulary. */
  keywords: z.array(z.string()),
  riskIfUnsupported: z.enum(["low", "medium", "high"]),
});
export type ResumeClaim = z.infer<typeof ResumeClaim>;

export const ResumeAnalysis = z.object({
  claims: z.array(ResumeClaim),
  headline: z.string(),
});
export type ResumeAnalysis = z.infer<typeof ResumeAnalysis>;

export const ClaimCheck = z.object({
  claim: z.string(),
  supported: z.boolean(),
  evidence: z.array(z.string()),
  note: z.string(),
});
export type ClaimCheck = z.infer<typeof ClaimCheck>;

export const TargetRole = z.object({
  title: z.string(),
  company: z.string().nullable(),
  /** Weight per technology keyword, 0..1, used by the stage-07 ranker. */
  stackWeights: z.record(z.string(), z.number()),
  emphasis: z.array(z.string()),
});
export type TargetRole = z.infer<typeof TargetRole>;

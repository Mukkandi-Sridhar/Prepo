import { z } from "zod";

/**
 * The ProjectDossier is stage 05's only output: one frontier-model call over
 * RepoFacts plus every directory rollup. Everything downstream reads this
 * instead of re-reading the repository, which is what keeps question
 * generation cheap enough to fan out ten ways.
 */

export const Component = z.object({
  name: z.string(),
  role: z.string(),
  paths: z.array(z.string()),
  dependsOn: z.array(z.string()),
});
export type Component = z.infer<typeof Component>;

export const Decision = z.object({
  decision: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()),
  /** What an interviewer would push on. */
  tradeoff: z.string(),
  evidence: z.array(z.string()),
});
export type Decision = z.infer<typeof Decision>;

export const WeakSpot = z.object({
  issue: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  where: z.array(z.string()),
  why: z.string(),
});
export type WeakSpot = z.infer<typeof WeakSpot>;

/**
 * Hotspots are the whole point of the dossier. They are the places a good
 * interviewer would actually poke, ranked, and they drive both question
 * generation and the mock interview's plan.
 */
export const Hotspot = z.object({
  title: z.string(),
  paths: z.array(z.string()),
  whyInteresting: z.string(),
  difficulty: z.enum(["L1", "L2", "L3"]),
  angles: z.array(z.string()),
});
export type Hotspot = z.infer<typeof Hotspot>;

export const ProjectDossier = z.object({
  summary: z.string(),
  elevatorPitch: z.string(),
  architecture: z.string(),
  dataFlow: z.string(),
  components: z.array(Component),
  decisions: z.array(Decision),
  weakSpots: z.array(WeakSpot),
  hotspots: z.array(Hotspot),
  /** Honest read on how much there is to interrogate here. */
  complexity: z.enum(["trivial", "moderate", "substantial", "large"]),
  complexityNote: z.string(),
});
export type ProjectDossier = z.infer<typeof ProjectDossier>;

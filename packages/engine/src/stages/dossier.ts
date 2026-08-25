import { dossier as dossierPrompt } from "@prepo/prompts";
import { ProjectDossier, type RepoFacts } from "@prepo/shared";
import type { PipelineContext } from "../context.js";

/**
 * Stage 05. One call, the best model configured, and the highest-leverage
 * moment in the pipeline: every question generated afterwards inherits the
 * quality of this output. Spending here and economising everywhere else is
 * the whole shape of the cost model.
 */
export async function synthesiseDossier(
  ctx: PipelineContext,
  facts: RepoFacts,
  rollups: Array<{ dir: string; summary: string }>,
): Promise<ProjectDossier> {
  await ctx.onProgress("dossier", 0.1, "Reading the whole project at once");

  const result = await ctx.llm.object({
    tier: "frontier",
    stage: "05-dossier",
    effort: "high",
    system: dossierPrompt.system,
    messages: [{ role: "user", content: dossierPrompt.user({ facts, rollups }) }],
    schema: ProjectDossier,
    schemaName: "ProjectDossier",
    schemaDescription:
      "A structured engineering dossier: summary, architecture, data flow, components, decisions, weak spots, and ranked interview hotspots.",
    maxTokens: 16_000,
    signal: ctx.signal,
  });

  await ctx.onProgress("dossier", 1, `Found ${result.hotspots.length} interview hotspots`);
  return result;
}

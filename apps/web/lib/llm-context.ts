import { getDb } from "@prepo/db";
import { CostMeter, createEmbedder, createLlmClient } from "@prepo/llm";
import { resolveCredentials, type PipelineContext } from "@prepo/engine";
import { config } from "@prepo/shared";

/**
 * Builds a pipeline context for work that happens in a request rather than in
 * the worker — the mock interview, mostly. Interview turns are interactive and
 * short, so they run inline instead of going through the queue; a queued turn
 * would feel like a broken conversation.
 */
export async function requestContext(userId: string, budgetCents?: number): Promise<PipelineContext> {
  const db = getDb();
  const meter = new CostMeter(budgetCents ?? config.limits.budgetCentsPerRun);
  const credentials = await resolveCredentials(db, userId);

  return {
    db,
    llm: createLlmClient(credentials, meter, createEmbedder()),
    userId,
    jobId: null,
    async onProgress() {
      // Nothing to report: the caller is the one waiting.
    },
  };
}

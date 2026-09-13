import { eq, getDb, jobs, notifyJob, questionSets, resumes, targetRoles, usageEvents } from "@prepo/db";
import { CostMeter, createEmbedder, createLazyLlmClient } from "@prepo/llm";
import {
  overallProgress,
  resolveCredentials,
  runPipeline,
  STAGE_LABELS,
  type PipelineContext,
  type StageId,
} from "@prepo/engine";
import { config, PrepoError, scrubForLog, toPublicError } from "@prepo/shared";
import { ANALYZE_QUEUE, getBoss, stopBoss, type AnalyzeJob } from "./queue.js";

const db = getDb();

function log(message: string, detail?: unknown): void {
  const line = `[worker] ${new Date().toISOString()} ${message}`;
  if (detail === undefined) console.log(line);
  else console.log(line, JSON.stringify(scrubForLog(detail)));
}

async function handle(payload: AnalyzeJob): Promise<void> {
  const started = Date.now();
  log(`job ${payload.jobId} started`, { project: payload.projectId, source: payload.sourceType });

  const controller = new AbortController();

  const meter = new CostMeter(payload.budgetCents ?? config.limits.budgetCentsPerRun, async (event) => {
    // Usage is written per event rather than batched at the end, so a run that
    // dies halfway still accounts for what it spent.
    await db.insert(usageEvents).values({
      userId: payload.userId,
      jobId: payload.jobId,
      stage: event.stage,
      provider: event.provider,
      model: event.model,
      inputTokens: event.usage.inputTokens,
      outputTokens: event.usage.outputTokens,
      cachedTokens: event.usage.cachedTokens,
      costCents: event.costCents ?? 0,
    });
  });

  // Credential resolution is deferred to the first stage that actually needs
  // an LLM. Stages 01–03 (acquire, filter, extract facts) are deterministic
  // and free by design — they must not fail just because no provider is
  // configured yet, and they persist the Repo Card's facts to the snapshot
  // before stage 04 would ever touch this client. See lazy-provider.ts.
  const llm = createLazyLlmClient(() => resolveCredentials(db, payload.userId), meter, createEmbedder());

  const ctx: PipelineContext = {
    db,
    llm,
    userId: payload.userId,
    jobId: payload.jobId,
    signal: controller.signal,
    async onProgress(stage: StageId, fraction: number, note?: string) {
      const progress = overallProgress(stage, fraction);
      await db
        .update(jobs)
        .set({ state: "running", stage, progress, spentCents: meter.spentCents })
        .where(eq(jobs.id, payload.jobId));

      await notifyJob({
        jobId: payload.jobId,
        state: "running",
        stage: STAGE_LABELS[stage],
        progress,
        note,
        spentCents: meter.spentCents,
      });
    },
  };

  try {
    await db
      .update(jobs)
      .set({ state: "running", stage: "acquire", progress: 0 })
      .where(eq(jobs.id, payload.jobId));

    // Resume and role are optional context for tailoring.
    const [resume, role] = await Promise.all([
      payload.resumeId
        ? db.query.resumes.findFirst({ where: eq(resumes.id, payload.resumeId) })
        : Promise.resolve(undefined),
      payload.roleId
        ? db.query.targetRoles.findFirst({ where: eq(targetRoles.id, payload.roleId) })
        : Promise.resolve(undefined),
    ]);

    const result = await runPipeline(ctx, {
      projectId: payload.projectId,
      jobId: payload.jobId,
      sourceType: payload.sourceType,
      sourceUrl: payload.sourceUrl,
      zipPath: payload.zipPath,
      scopedModules: payload.scopedModules,
      resumeClaims: resume?.claims?.map((c) => c.claim),
      targetRole: role ? `${role.title}${role.company ? ` at ${role.company}` : ""}` : undefined,
    });

    if (payload.resumeId || payload.roleId) {
      await db
        .update(questionSets)
        .set({ resumeId: payload.resumeId ?? null, roleId: payload.roleId ?? null })
        .where(eq(questionSets.id, result.questionSetId));
    }

    await db
      .update(jobs)
      .set({
        state: "done",
        progress: 1,
        stage: "verify",
        spentCents: meter.spentCents,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, payload.jobId));

    await notifyJob({
      jobId: payload.jobId,
      state: "done",
      stage: "Finished",
      progress: 1,
      note: `${result.questionCount} questions · ${result.droppedCount} dropped in verification`,
      spentCents: meter.spentCents,
      questionSetId: result.questionSetId,
    });

    log(`job ${payload.jobId} done in ${((Date.now() - started) / 1000).toFixed(1)}s`, {
      questions: result.questionCount,
      dropped: result.droppedCount,
      cents: meter.spentCents.toFixed(3),
    });
  } catch (err) {
    const publicError = toPublicError(err);
    const detail = err instanceof PrepoError ? err.detail : undefined;

    await db
      .update(jobs)
      .set({
        state: "failed",
        error: publicError.message,
        spentCents: meter.spentCents,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, payload.jobId));

    await notifyJob({
      jobId: payload.jobId,
      state: "failed",
      stage: null,
      progress: 0,
      error: publicError.message,
      spentCents: meter.spentCents,
    });

    log(`job ${payload.jobId} FAILED: ${publicError.message}`, detail);
    // Rethrow so pg-boss records the failure; the retry policy decides the rest.
    throw err;
  }
}

async function main(): Promise<void> {
  const boss = await getBoss();

  await boss.work<AnalyzeJob>(
    ANALYZE_QUEUE,
    { batchSize: 1, pollingIntervalSeconds: 2 },
    async (messages) => {
      for (const message of messages) await handle(message.data);
    },
  );

  log(`listening on "${ANALYZE_QUEUE}" · concurrency ${config.limits.jobConcurrency}`);

  const shutdown = async (signal: string) => {
    log(`${signal} received, finishing current job then exiting`);
    await stopBoss();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});

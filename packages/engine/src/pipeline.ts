import {
  and,
  citations as citationsTable,
  dossiers,
  eq,
  jobSteps,
  jobs,
  projects,
  questionSets,
  questions as questionsTable,
  repoSnapshots,
} from "@prepo/db";
import type { ProjectDossier, RepoFacts } from "@prepo/shared";
import { PrepoError, config } from "@prepo/shared";
import { promptFingerprint } from "@prepo/prompts";
import { overallProgress, STAGE_LABELS, type PipelineContext, type StageId } from "./context.js";
import { cloneRepo, extractZip, repoNameFromUrl } from "./stages/acquire.js";
import { collect, type CollectResult } from "./stages/collect.js";
import { extractFacts } from "./stages/facts.js";
import { mapSemantics } from "./stages/map.js";
import { synthesiseDossier } from "./stages/dossier.js";
import { generateQuestions } from "./stages/questions.js";
import { verifyQuestions } from "./stages/verify.js";
import { sha256 } from "./util.js";

export interface RunInput {
  projectId: string;
  jobId: string;
  sourceType: "git" | "zip";
  sourceUrl?: string;
  zipPath?: string;
  githubToken?: string;
  scopedModules?: string[];
  resumeClaims?: string[];
  targetRole?: string;
}

export interface RunOutput {
  snapshotId: string;
  questionSetId: string;
  facts: RepoFacts;
  dossier: ProjectDossier;
  questionCount: number;
  droppedCount: number;
  costCents: number;
}

/**
 * The orchestrator.
 *
 * Every stage writes a job_steps row keyed by an input hash. On restart, a
 * stage whose hash matches a completed row is skipped — so a worker that dies
 * during question generation resumes there instead of re-cloning, re-embedding
 * and re-summarising a repository that has not changed. Crash-resume costs
 * nothing, which also means deploying mid-job is safe.
 */
export async function runPipeline(ctx: PipelineContext, input: RunInput): Promise<RunOutput> {
  const step = makeStepRunner(ctx, input.jobId);

  /* ── 01 acquire ──────────────────────────────────────────── */

  await ctx.onProgress("acquire", 0, STAGE_LABELS.acquire);

  const acquired =
    input.sourceType === "git"
      ? await cloneRepo(input.sourceUrl!, input.githubToken)
      : await extractZip(input.zipPath!, "upload");

  try {
    const name =
      input.sourceType === "git" ? repoNameFromUrl(input.sourceUrl!) : "uploaded project";

    /* ── snapshot: the cache root ──────────────────────────── */

    const snapshotId = await upsertSnapshot(ctx, input.projectId, acquired.commitSha);
    await ctx.db.update(jobs).set({ snapshotId }).where(eq(jobs.id, input.jobId));

    const existing = await ctx.db.query.dossiers.findFirst({
      where: eq(dossiers.snapshotId, snapshotId),
    });

    /* ── 02 collect ────────────────────────────────────────── */

    await ctx.onProgress("collect", 0, STAGE_LABELS.collect);
    const collected: CollectResult = await collect(acquired.dir, input.scopedModules ?? []);

    if (
      collected.files.length > config.limits.moduleScopeThreshold &&
      (input.scopedModules ?? []).length === 0
    ) {
      throw new PrepoError(
        "repo_too_large",
        `This repository has ${collected.files.length.toLocaleString()} analysable files. Choose the modules you actually worked on — a deep pack on your part beats a vague one on everything.`,
        { modules: collected.modules },
      );
    }

    /* ── 03 facts ──────────────────────────────────────────── */

    await ctx.onProgress("facts", 0.3, STAGE_LABELS.facts);
    const facts = extractFacts({
      name,
      commitSha: acquired.commitSha,
      defaultBranch: acquired.defaultBranch,
      git: acquired.git,
      collected,
      scopedModules: input.scopedModules,
    });

    await ctx.db
      .update(repoSnapshots)
      .set({
        repoFacts: facts,
        redactionReport: collected.redaction,
        fileCount: collected.totalFilesSeen,
        sizeBytes: collected.sizeBytes,
      })
      .where(eq(repoSnapshots.id, snapshotId));

    await ctx.onProgress("facts", 1, `${facts.analysedFileCount} files, ${facts.totalLoc.toLocaleString()} LOC`);

    /* ── 04–05: skip entirely if this commit already has a dossier ── */

    let dossier: ProjectDossier;

    if (existing) {
      dossier = existing.content;
      await ctx.onProgress("map", 1, "Reusing the cached analysis for this commit");
      await ctx.onProgress("dossier", 1, "Dossier already built for this commit");
    } else {
      const mapped = await step("map", sha256(facts.commitSha + facts.analysedFileCount), () =>
        mapSemantics(ctx, snapshotId, collected.files),
      );

      dossier = await step("dossier", sha256(facts.commitSha + promptFingerprint()), async () => {
        const result = await synthesiseDossier(ctx, facts, mapped.rollups);
        await ctx.db
          .insert(dossiers)
          .values({
            snapshotId,
            content: result,
            model: ctx.llm.provider.id,
            costCents: ctx.llm.meter.spentCents,
          })
          .onConflictDoNothing();
        return result;
      });
    }

    /* ── 06 questions ──────────────────────────────────────── */

    await ctx.onProgress("questions", 0, STAGE_LABELS.questions);
    const generated = await generateQuestions(ctx, {
      snapshotId,
      facts,
      dossier,
      resumeClaims: input.resumeClaims,
      targetRole: input.targetRole,
    });

    if (generated.questions.length === 0) {
      throw new PrepoError(
        "provider_error",
        "No questions could be generated. This usually means the model provider rejected every request — check the key in Settings.",
      );
    }

    /* ── 07 verify ─────────────────────────────────────────── */

    await ctx.onProgress("verify", 0, STAGE_LABELS.verify);
    const verified = await verifyQuestions(ctx, {
      snapshotId,
      facts,
      dossier,
      questions: generated.questions,
      resumeClaims: input.resumeClaims,
    });

    /* ── persist ───────────────────────────────────────────── */

    const droppedCount =
      verified.dropped.unresolvedCitations + verified.dropped.unsupported + verified.dropped.duplicates;

    const [set] = await ctx.db
      .insert(questionSets)
      .values({
        snapshotId,
        questionCount: verified.questions.length,
        droppedCount,
        costCents: ctx.llm.meter.spentCents,
      })
      .returning({ id: questionSets.id });

    const setId = set!.id;

    for (const question of verified.questions) {
      const [row] = await ctx.db
        .insert(questionsTable)
        .values({
          setId,
          category: question.category,
          difficulty: question.difficulty,
          persona: question.persona,
          stem: question.stem,
          modelAnswer: question.modelAnswer,
          probes: question.probes,
          testingFor: question.testingFor,
          redFlags: question.redFlags,
          starFrame: question.starFrame,
          groundedness: question.groundedness.toFixed(2),
          rank: question.rank,
        })
        .returning({ id: questionsTable.id });

      if (question.citations.length > 0) {
        await ctx.db.insert(citationsTable).values(
          question.citations.map((c) => ({
            questionId: row!.id,
            path: c.path,
            startLine: c.startLine,
            endLine: c.endLine,
            symbol: c.symbol,
            commitSha: facts.commitSha,
          })),
        );
      }
    }

    await ctx.db
      .update(projects)
      .set({ currentSnapshotId: snapshotId, name })
      .where(eq(projects.id, input.projectId));

    return {
      snapshotId,
      questionSetId: setId,
      facts,
      dossier,
      questionCount: verified.questions.length,
      droppedCount,
      costCents: ctx.llm.meter.spentCents,
    };
  } finally {
    // The working copy is disposable; the snapshot lives in Postgres.
    await acquired.cleanup().catch(() => {});
  }
}

async function upsertSnapshot(ctx: PipelineContext, projectId: string, commitSha: string): Promise<string> {
  const existing = await ctx.db.query.repoSnapshots.findFirst({
    where: and(eq(repoSnapshots.projectId, projectId), eq(repoSnapshots.commitSha, commitSha)),
  });
  if (existing) return existing.id;

  const [row] = await ctx.db
    .insert(repoSnapshots)
    .values({ projectId, commitSha })
    .onConflictDoNothing()
    .returning({ id: repoSnapshots.id });

  if (row) return row.id;

  // Lost the race with a concurrent job for the same commit — read it back.
  const raced = await ctx.db.query.repoSnapshots.findFirst({
    where: and(eq(repoSnapshots.projectId, projectId), eq(repoSnapshots.commitSha, commitSha)),
  });
  if (!raced) throw new PrepoError("internal", "Could not create a snapshot record.");
  return raced.id;
}

/**
 * Wraps a stage in its job_steps checkpoint. `inputHash` is what makes resume
 * correct rather than merely fast: a stage is only skipped when the inputs
 * that produced the stored output are the same ones we have now.
 */
function makeStepRunner(ctx: PipelineContext, jobId: string) {
  return async function step<T>(stage: StageId, inputHash: string, fn: () => Promise<T>): Promise<T> {
    const existing = await ctx.db.query.jobSteps.findFirst({
      where: and(eq(jobSteps.jobId, jobId), eq(jobSteps.stage, stage)),
    });

    if (existing?.state === "done" && existing.inputHash === inputHash && existing.outputRef) {
      return JSON.parse(existing.outputRef) as T;
    }

    await ctx.db
      .insert(jobSteps)
      .values({ jobId, stage, state: "running", inputHash, startedAt: new Date() })
      .onConflictDoUpdate({
        target: [jobSteps.jobId, jobSteps.stage],
        set: { state: "running", inputHash, startedAt: new Date(), error: null },
      });

    try {
      const result = await fn();
      await ctx.db
        .update(jobSteps)
        .set({ state: "done", outputRef: JSON.stringify(result), finishedAt: new Date() })
        .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stage, stage)));
      return result;
    } catch (err) {
      await ctx.db
        .update(jobSteps)
        .set({
          state: "failed",
          error: err instanceof Error ? err.message.slice(0, 2_000) : "unknown",
          finishedAt: new Date(),
        })
        .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stage, stage)));
      throw err;
    }
  };
}

export { overallProgress };

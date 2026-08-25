import { z } from "zod";
import { questions as questionsPrompt } from "@prepo/prompts";
import {
  GeneratedQuestion,
  type Difficulty,
  type Persona,
  type ProjectDossier,
  type QuestionCategory,
  type RepoFacts,
} from "@prepo/shared";
import type { PipelineContext } from "../context.js";
import { retrieve } from "../retrieval.js";
import { mapLimitSettled } from "../util.js";

export interface GenerationTask {
  category: QuestionCategory;
  difficulty: Difficulty;
  persona: Persona;
  count: number;
  query: string;
}

export interface GenerateInput {
  snapshotId: string;
  facts: RepoFacts;
  dossier: ProjectDossier;
  resumeClaims?: string[];
  targetRole?: string;
}

export interface GenerateResult {
  questions: Array<GeneratedQuestion & { persona: Persona }>;
  tasksAttempted: number;
  tasksFailed: number;
}

const Batch = z.object({ questions: z.array(GeneratedQuestion).min(1).max(14) });

const GENERATOR_CONCURRENCY = 4;

/**
 * Retrieval queries per category. These are deliberately written in the
 * vocabulary of code rather than the vocabulary of interviews — the index
 * contains source files, so "transaction commit rollback" retrieves better
 * than "questions about data integrity".
 */
const CATEGORY_QUERIES: Record<QuestionCategory, string> = {
  walkthrough: "main entrypoint application bootstrap startup configuration router",
  architecture: "service layer module boundary dependency injection interface abstraction queue worker",
  language: "async await generic type closure decorator lifecycle hook memory reference",
  "data-modeling": "schema migration table column index foreign key relation model entity",
  "api-design": "route handler request response validation status code middleware serializer pagination",
  performance: "cache concurrency parallel batch loop query n+1 index lock timeout pool",
  security: "auth token session password permission role sanitize escape cors csrf secret encryption",
  testing: "test describe expect mock fixture assertion coverage integration setup teardown",
  devops: "dockerfile compose deploy pipeline environment variable health check build stage",
  debugging: "error catch throw retry log trace exception fallback recover timeout circuit",
  scaling: "queue worker shard replica partition rate limit backpressure cache invalidation",
  tradeoffs: "config option choice alternative library dependency version adapter strategy",
  behavioral: "readme contributing todo fixme refactor comment rationale decision",
};

/**
 * Builds the fan-out. Two things it gets right that a naive version would not:
 *
 *  - Difficulty is weighted toward L2/L3, because L1 questions are the ones a
 *    candidate can already answer and are therefore the least useful output.
 *  - On a trivial project it drops the categories that would force the model
 *    to invent depth, and leans into stack choices and "how would you scale
 *    this" instead. Saying "there isn't much here" honestly beats faking it.
 */
export function buildPlan(dossier: ProjectDossier, facts: RepoFacts): GenerationTask[] {
  const trivial = dossier.complexity === "trivial";

  const categories: Array<[QuestionCategory, number]> = [
    ["walkthrough", 6],
    ["architecture", trivial ? 4 : 10],
    ["language", 8],
    ["data-modeling", facts.tables.length > 0 ? 8 : 3],
    ["api-design", facts.routes.length > 0 ? 8 : 3],
    ["performance", trivial ? 4 : 8],
    ["security", 7],
    ["testing", facts.testFileCount > 0 ? 6 : 4],
    ["devops", facts.hasDockerfile || facts.ciProviders.length > 0 ? 6 : 4],
    ["debugging", trivial ? 3 : 7],
    ["scaling", 8],
    ["tradeoffs", 8],
    ["behavioral", 5],
  ];

  const personas: Persona[] = ["hiring-manager", "tech-lead", "peer", "bar-raiser"];
  const hotspotHints = dossier.hotspots
    .slice(0, 6)
    .map((h) => `${h.title} ${h.paths.join(" ")}`)
    .join(" ");

  const tasks: GenerationTask[] = [];
  let personaIndex = 0;

  for (const [category, count] of categories) {
    if (count <= 0) continue;

    // Difficulty split, biased away from screening questions.
    const split: Array<[Difficulty, number]> =
      category === "walkthrough"
        ? [["L1", Math.ceil(count * 0.5)], ["L2", Math.floor(count * 0.5)]]
        : [
            ["L1", Math.round(count * 0.2)],
            ["L2", Math.round(count * 0.45)],
            ["L3", count - Math.round(count * 0.2) - Math.round(count * 0.45)],
          ];

    for (const [difficulty, n] of split) {
      if (n <= 0) continue;
      tasks.push({
        category,
        difficulty,
        // Bar-raiser gets the L3 work; the rest rotate so the pack has more
        // than one voice in it.
        persona: difficulty === "L3" ? "bar-raiser" : personas[personaIndex++ % 3]!,
        count: Math.min(n, 8),
        query: `${CATEGORY_QUERIES[category]} ${hotspotHints}`.slice(0, 400),
      });
    }
  }

  return tasks;
}

/**
 * Stage 06. Tasks run in parallel and each does its own retrieval, so every
 * question is anchored to chunks that actually exist. The dossier goes in as
 * `cachedPrefix` — byte-identical across all tasks — so the provider serves
 * one prefill from cache instead of charging for twenty.
 */
export async function generateQuestions(
  ctx: PipelineContext,
  input: GenerateInput,
): Promise<GenerateResult> {
  const plan = buildPlan(input.dossier, input.facts);
  const prefix = questionsPrompt.dossierPrefix(input.dossier, input.facts);

  let completed = 0;
  const results = await mapLimitSettled(plan, GENERATOR_CONCURRENCY, async (task) => {
    ctx.signal?.throwIfAborted();

    const chunks = await retrieve(ctx, input.snapshotId, task.query, 10);

    const batch = await ctx.llm.object({
      tier: "balanced",
      stage: `06-questions:${task.category}`,
      effort: "high",
      cachedPrefix: prefix,
      system: questionsPrompt.system,
      messages: [
        {
          role: "user",
          content: questionsPrompt.user({
            category: task.category,
            difficulty: task.difficulty,
            persona: task.persona,
            count: task.count,
            chunks: chunks.map((c) => ({
              path: c.path,
              symbol: c.symbol,
              startLine: c.startLine,
              endLine: c.endLine,
              content: c.content,
            })),
            resumeClaims: input.resumeClaims,
            targetRole: input.targetRole,
          }),
        },
      ],
      schema: Batch,
      schemaName: "QuestionBatch",
      schemaDescription: `${task.count} interview questions in the ${task.category} category with grounded answers and citations`,
      maxTokens: 16_000,
      signal: ctx.signal,
    });

    completed++;
    await ctx.onProgress(
      "questions",
      completed / plan.length,
      `${completed}/${plan.length} categories · ${task.category}`,
    );

    // The model is asked for one category and one difficulty; trust but verify,
    // because a mislabelled question corrupts the whole filter UI.
    return batch.questions.map((q) => ({
      ...q,
      category: task.category,
      difficulty: task.difficulty,
      persona: task.persona,
      redFlags: q.redFlags ?? [],
      starFrame: q.starFrame ?? null,
      citations: q.citations.map((c) => ({ ...c, symbol: c.symbol ?? null })),
    }));
  });

  const questions = results.flatMap((r) => (r.ok ? r.value : []));
  const failed = results.filter((r) => !r.ok).length;

  return { questions, tasksAttempted: plan.length, tasksFailed: failed };
}

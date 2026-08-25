import type { Db } from "@prepo/db";
import type { LlmClient } from "@prepo/llm";

export type StageId =
  | "acquire"
  | "collect"
  | "facts"
  | "map"
  | "dossier"
  | "questions"
  | "verify";

export const STAGE_ORDER: StageId[] = [
  "acquire",
  "collect",
  "facts",
  "map",
  "dossier",
  "questions",
  "verify",
];

export const STAGE_LABELS: Record<StageId, string> = {
  acquire: "Fetching the repository",
  collect: "Filtering and scanning for secrets",
  facts: "Reading the project structure",
  map: "Summarising and indexing the code",
  dossier: "Building the project dossier",
  questions: "Writing interview questions",
  verify: "Checking every answer against the code",
};

/** Rough share of wall-clock each stage takes, used to drive the progress bar. */
export const STAGE_WEIGHTS: Record<StageId, number> = {
  acquire: 0.06,
  collect: 0.05,
  facts: 0.03,
  map: 0.4,
  dossier: 0.15,
  questions: 0.2,
  verify: 0.11,
};

export interface PipelineContext {
  db: Db;
  llm: LlmClient;
  userId: string;
  jobId: string | null;
  signal?: AbortSignal;
  /** Reports stage-local progress in 0..1; the pipeline maps it to overall. */
  onProgress(stage: StageId, fraction: number, note?: string): Promise<void>;
}

export function overallProgress(stage: StageId, fraction: number): number {
  let base = 0;
  for (const s of STAGE_ORDER) {
    if (s === stage) break;
    base += STAGE_WEIGHTS[s];
  }
  return Math.min(1, base + STAGE_WEIGHTS[stage] * Math.max(0, Math.min(1, fraction)));
}

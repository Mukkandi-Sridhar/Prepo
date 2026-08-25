import * as fileSummaryV1 from "./file-summary/v1.js";
import * as dossierV1 from "./dossier/v1.js";
import * as questionsV1 from "./questions/v1.js";
import * as criticV1 from "./critic/v1.js";
import * as interviewerV1 from "./interviewer/v1.js";
import * as scorerV1 from "./scorer/v1.js";
import * as resumeV1 from "./resume/v1.js";

export * as fileSummary from "./file-summary/v1.js";
export * as dossier from "./dossier/v1.js";
export * as questions from "./questions/v1.js";
export * as critic from "./critic/v1.js";
export * as interviewer from "./interviewer/v1.js";
export * as scorer from "./scorer/v1.js";
export * as resume from "./resume/v1.js";
export * from "./lib.js";

/**
 * Prompts are versioned files, not string literals scattered through the
 * engine. Two consequences worth the small ceremony:
 *
 *  1. A prompt change shows up in a pull request as a diff to a file whose
 *     only job is that prompt, and CI can gate it on an eval run.
 *  2. Every generated artefact records which prompt version produced it, so
 *     a regression can be traced to the change that caused it.
 *
 * Bumping a prompt means adding v2.ts beside v1.ts and changing one line here.
 */
export const PROMPT_VERSIONS = {
  "file-summary": fileSummaryV1.version,
  dossier: dossierV1.version,
  questions: questionsV1.version,
  critic: criticV1.version,
  interviewer: interviewerV1.version,
  scorer: scorerV1.version,
  resume: resumeV1.version,
} as const;

export type PromptName = keyof typeof PROMPT_VERSIONS;

/** Stamped onto question sets and dossiers so results are traceable to prompts. */
export function promptFingerprint(): string {
  return Object.entries(PROMPT_VERSIONS)
    .map(([name, version]) => `${name}@${version}`)
    .join(",");
}

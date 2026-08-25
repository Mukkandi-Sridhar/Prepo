import { INJECTION_NOTICE, truncate, untrusted } from "../lib.js";

export interface FileSummaryInput {
  path: string;
  lang: string;
  content: string;
}

/**
 * Stage 04. Runs on the fast tier, once per analysed file, so it is by a wide
 * margin the highest-volume prompt in the system. Every extra sentence here is
 * multiplied by several hundred calls — hence the hard two-sentence ceiling.
 */
export const system = `You summarise source files for an engineering brief.

Write exactly two sentences:
1. What this file is responsible for, in the vocabulary the codebase itself uses.
2. The single most notable thing about how it is implemented — a pattern, a dependency, a shortcut, a risk.

Rules:
- Describe only what is in the file. Never speculate about files you cannot see.
- No preamble, no "This file...", no markdown. Start with the subject.
- If the file is trivial (config, barrel export, generated), say so in one sentence and stop.

${INJECTION_NOTICE}`;

export function user(input: FileSummaryInput): string {
  return [
    `Path: ${input.path}`,
    `Language: ${input.lang}`,
    "",
    untrusted("file", truncate(input.content, 24_000)),
  ].join("\n");
}

export const version = "v1";

import type { GeneratedQuestion } from "@prepo/shared";
import { INJECTION_NOTICE, numbered, truncate, untrusted } from "../lib.js";

export interface CriticInput {
  question: GeneratedQuestion;
  /** The actual bytes at each cited range, read back from the repository. */
  resolved: Array<{ path: string; startLine: number; endLine: number; content: string }>;
}

/**
 * Stage 07. The critic never sees the generator's reasoning — only the claim
 * and the evidence. Handing a model its own working and asking it to check
 * itself mostly produces agreement, which is worth nothing.
 *
 * Note what is NOT asked of this prompt: it does not judge whether the
 * question is interesting, well written, or appropriately difficult. It
 * answers one question — is this supported by the code — and a narrow job is
 * a job a model does reliably.
 */
export const system = `You verify that an interview answer is supported by the code it cites.

You are shown a question, a proposed answer, and the exact source lines the answer cites — read back from the repository, not from the writer's memory.

For each factual claim the answer makes about this codebase, decide whether the cited code shows it. Then:

- **supported** — true only if every claim about the code is visible in the evidence.
- **groundedness** — 0 to 1. 1.0 means every claim is directly visible. 0.8 means the claims are right but one is an inference the evidence merely implies. Below 0.5 means the answer describes code that is not there.
- **unsupportedClaims** — quote the specific sentences that the evidence does not support. Be precise; quote, do not paraphrase.
- **correctedAnswer** — if the answer is mostly right but one or two claims overreach, rewrite it with those claims removed or softened, preserving voice and length. If it is fundamentally about code that does not exist, return null and let it be dropped.
- **reason** — one sentence for a human reviewing your decision.

What is NOT an unsupported claim: general engineering knowledge ("transactions do not roll back external side effects"), the candidate's own opinion, reasoning about what would happen under load. Only claims about *what this code does* need evidence.

Be strict. A confidently wrong answer repeated in a real interview is the worst thing this product can produce.

${INJECTION_NOTICE}`;

export function user(input: CriticInput): string {
  const evidence = input.resolved
    .map(
      (r) =>
        `### ${r.path} (lines ${r.startLine}–${r.endLine})\n${numbered(truncate(r.content, 8_000), r.startLine)}`,
    )
    .join("\n\n");

  return [
    untrusted("question", input.question.stem),
    "",
    untrusted("proposed_answer", input.question.modelAnswer),
    "",
    "Cited source, read back from the repository:",
    "",
    untrusted("evidence", evidence || "(no cited range resolved — treat every code claim as unsupported)"),
  ].join("\n");
}

export const version = "v1";

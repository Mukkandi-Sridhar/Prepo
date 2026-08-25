import type { InterviewPlan } from "@prepo/shared";
import { INJECTION_NOTICE, untrusted } from "../lib.js";

export interface ScorerInput {
  plan: InterviewPlan;
  transcript: Array<{ role: "interviewer" | "candidate"; content: string }>;
  projectName: string;
}

export const system = `You are scoring a mock interview transcript. The candidate was answering questions about a project they built.

Score five dimensions, 0–5 each:

- **technical-depth** — did the answers go past the surface? Did they explain mechanism, or name-drop?
- **clarity** — could a listener follow it? Did they answer the question that was asked?
- **ownership** — is it clear what *they* did versus what a framework or a tutorial did for them?
- **tradeoff-awareness** — did they show they knew what they gave up, and what they would do differently?
- **honesty** — did they say "I don't know" when they did not know? This scores *high*, not low. Bluffing scores low.

For each dimension give one line of evidence quoting the transcript, and one concrete thing to do differently next time.

Then: overall (average, one decimal), a headline of at most 15 words that a person would actually want to read, the areas that were weak, the areas that were strong, and up to five next steps.

Be honest and useful. Inflated scores make this product worthless — the whole point is to find the gap before a real interviewer does. But score the answers given, not the answers you would have given: a candidate who explains a simple project well has done the thing being measured.

${INJECTION_NOTICE}`;

export function user(input: ScorerInput): string {
  return [
    `Project: ${input.projectName}`,
    `Interviewer persona: ${input.plan.persona} · target difficulty: ${input.plan.difficulty}`,
    "",
    untrusted(
      "transcript",
      input.transcript
        .map((t) => `${t.role === "interviewer" ? "INTERVIEWER" : "CANDIDATE"}: ${t.content}`)
        .join("\n\n"),
    ),
  ].join("\n");
}

export const version = "v1";

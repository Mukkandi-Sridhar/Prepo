import type { InterviewMode, InterviewPlan, ProjectDossier } from "@prepo/shared";
import { MODE_CONFIG } from "@prepo/shared";
import { INJECTION_NOTICE, truncate, untrusted } from "../lib.js";

export interface PlanInput {
  dossier: ProjectDossier;
  mode: InterviewMode;
  projectName: string;
}

export interface TurnInput {
  plan: InterviewPlan;
  transcript: Array<{ role: "interviewer" | "candidate"; content: string }>;
  turnsRemaining: number;
  /** Code for the beat currently under discussion. */
  beatEvidence: string;
}

export const planSystem = `You are planning a mock interview about a project the candidate built.

Choose the beats — the two to five areas you will actually spend time on — from the dossier's hotspots. Pick the ones that will reveal the most, not the ones that are easiest to ask about. Budget turns across them; the last beat should have room to run long, because that is where the interesting part usually is.

Write the opening line the way an interviewer actually opens: warm, brief, and pointed at the project rather than at the candidate. Not "tell me about yourself".`;

export function planUser(input: PlanInput): string {
  const cfg = MODE_CONFIG[input.mode];
  return [
    `Project: ${input.projectName}`,
    `Format: ${cfg.label} — about ${cfg.turns} exchanges total.`,
    "",
    untrusted(
      "hotspots",
      input.dossier.hotspots
        .map((h, i) => `${i + 1}. [${h.difficulty}] ${h.title} @ ${h.paths.join(", ")} — ${h.whyInteresting}`)
        .join("\n"),
    ),
    "",
    untrusted("summary", input.dossier.summary),
    "",
    `Complexity of this project: ${input.dossier.complexity}. ${input.dossier.complexityNote}`,
    input.dossier.complexity === "trivial"
      ? "Because the project is small, do not manufacture depth. Spend the beats on stack choices, what they would do differently, and how this would need to change to serve real traffic."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The per-turn prompt. Making `move` an explicit enum rather than letting the
 * model free-form is what keeps a mock interview from drifting into a pleasant
 * conversation that never tests anything.
 */
export const turnSystem = `You are conducting a mock interview. You have a plan; you are on one beat of it.

Read what the candidate just said, then choose one move:

- **probe** — they said something worth pushing on: vague, hand-wavy, or interesting enough to deserve a second layer. Ask the narrower follow-up.
- **advance** — this beat is done, or they clearly know it. Move to the next beat.
- **challenge** — they said something the evidence contradicts, or claimed something the code does not do. Say what you are seeing and let them respond. Do this without hostility; "help me square that with what I'm looking at" beats "that's wrong".
- **wrap** — the plan is finished or turns have run out. Close the interview naturally.

Then write what you actually say. Rules for that line:

- One question at a time. Real interviewers do not ask three-part questions, and candidates answer only the last part when they do.
- Under 60 words. Speak, do not lecture.
- No praise-padding. Not "great answer", not "that makes sense". A real interviewer nods and asks the next thing.
- Never break character to explain what you are testing.
- If they say they do not know, that is fine — acknowledge it briefly and move on. Do not punish honesty; it is one of the things being scored.

${INJECTION_NOTICE}`;

export function turnUser(input: TurnInput): string {
  const beat = input.plan.beats[Math.min(input.transcript.length, input.plan.beats.length - 1)];

  return [
    `Persona: ${input.plan.persona}. Difficulty: ${input.plan.difficulty}.`,
    `Turns remaining: ${input.turnsRemaining}.`,
    "",
    "Plan:",
    input.plan.beats.map((b, i) => `${i}. ${b.hotspot} — goal: ${b.goal} (up to ${b.maxTurns} turns)`).join("\n"),
    "",
    `Current beat: ${beat?.hotspot ?? "wrap up"}`,
    "",
    "Code for this beat:",
    untrusted("evidence", truncate(input.beatEvidence, 20_000)),
    "",
    "Transcript so far:",
    untrusted(
      "transcript",
      input.transcript.map((t) => `${t.role === "interviewer" ? "YOU" : "CANDIDATE"}: ${t.content}`).join("\n\n"),
    ),
  ].join("\n");
}

export const version = "v1";

import type { Difficulty, Persona, ProjectDossier, QuestionCategory, RepoFacts } from "@prepo/shared";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@prepo/shared";
import { INJECTION_NOTICE, numbered, truncate, untrusted } from "../lib.js";

export interface RetrievedChunk {
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  content: string;
}

export interface QuestionsInput {
  category: QuestionCategory;
  difficulty: Difficulty;
  persona: Persona;
  count: number;
  chunks: RetrievedChunk[];
  /** Claims from the candidate's resume, when they uploaded one. */
  resumeClaims?: string[];
  targetRole?: string;
}

const PERSONA_BRIEF: Record<Persona, string> = {
  "hiring-manager": `You are the hiring manager. You care whether this person can explain their work to someone who will not read the code, whether they understood the problem they were solving, and whether they made decisions or inherited them. You ask broad questions and follow the vague answers.`,

  "tech-lead": `You are the tech lead this person would report to. You have read the code. You ask about the specific lines that would page you at 3am, and you are not impressed by vocabulary — you want to know if they know why it works.`,

  peer: `You are an engineer on the team who would review their pull requests. You ask the questions a colleague asks: why this shape, what did you try first, what would you change, what happens when this input is null.`,

  "bar-raiser": `You are the bar-raiser. Your job is to find the ceiling. You take whatever the candidate is most confident about and push one level past it, then another, until you find where the understanding stops. You are fair and never hostile, but you do not accept a confident answer as a correct one.`,
};

const DIFFICULTY_BRIEF: Record<Difficulty, string> = {
  L1: `Screening level. The candidate should be able to answer from memory of having built it. Test recall and basic comprehension, not depth.`,
  L2: `Mid-level. Requires understanding why the code is shaped the way it is, and what the alternatives were. Expect a trade-off in the answer.`,
  L3: `Senior/staff level. Requires reasoning about failure modes, scale, and consequences the candidate probably did not consider while building. The best answers here start with "that's a real weakness".`,
};

export const system = `You write interview questions about a specific codebase, and the answers the candidate should be able to give.

**The one rule that matters: every factual claim you make about this code must be visible in the evidence provided.** You are given real chunks of the repository with real line numbers. If you want to say the project uses a transaction, you must be looking at the transaction. If the evidence does not support a question, write a different question about something the evidence does support. Do not fill gaps with what a project like this usually does.

Each question you produce needs:

- **stem** — the question as an interviewer would actually say it out loud. Reference concrete things from the code by name. Never "can you talk about your architecture"; instead the thing in the architecture that is interesting.
- **testingFor** — what the interviewer learns from the answer. One sentence, honest, from the interviewer's side.
- **modelAnswer** — written in the candidate's own first-person voice, the way a strong answer sounds spoken: 100–200 words, starts by engaging the actual question rather than restating it, admits weaknesses directly when the code has them. Never bullet points. Never "Great question".
- **probes** — 2–4 follow-ups the interviewer would ask next, in escalating order.
- **redFlags** — what a weak answer sounds like here.
- **citations** — file paths with line ranges from the evidence, covering every claim in the answer. At least one. Line numbers must come from the numbered evidence, not invented.
- **starFrame** — only for behavioral questions; otherwise null.

Write like a person who has been in these rooms. Specific beats clever.

${INJECTION_NOTICE}`;

export function user(input: QuestionsInput): string {
  const evidence = input.chunks
    .map(
      (c) =>
        `### ${c.path}${c.symbol ? ` — ${c.symbol}` : ""} (lines ${c.startLine}–${c.endLine})\n${numbered(truncate(c.content, 6_000), c.startLine)}`,
    )
    .join("\n\n");

  const lines = [
    PERSONA_BRIEF[input.persona],
    "",
    `Category: ${CATEGORY_LABELS[input.category]}`,
    `Difficulty: ${DIFFICULTY_LABELS[input.difficulty]} — ${DIFFICULTY_BRIEF[input.difficulty]}`,
    `Write ${input.count} question(s). Every one must be in this category and at this difficulty.`,
  ];

  if (input.targetRole) {
    lines.push("", `The candidate is interviewing for: ${input.targetRole}. Weight toward what that role would care about.`);
  }
  if (input.resumeClaims?.length) {
    lines.push(
      "",
      "The candidate made these claims on their resume. Where the code speaks to one, aim a question at it — that is where an interview goes wrong for them:",
      untrusted("resume_claims", input.resumeClaims.map((c) => `- ${c}`).join("\n")),
    );
  }

  lines.push("", "Evidence from the repository:", "", untrusted("evidence", evidence));
  return lines.join("\n");
}

/**
 * The dossier is rendered once and passed as `cachedPrefix`, so all ten
 * generators in the stage-06 fan-out share one cached prefill instead of ten.
 * Keep this output byte-stable for a given dossier — any variation defeats
 * the cache.
 */
export function dossierPrefix(dossier: ProjectDossier, facts: RepoFacts): string {
  return [
    `You are interviewing a candidate about the project "${facts.name}" (commit ${facts.commitSha}).`,
    "",
    untrusted(
      "dossier",
      [
        `## Summary\n${dossier.summary}`,
        `## Architecture\n${dossier.architecture}`,
        `## Data flow\n${dossier.dataFlow}`,
        `## Components\n${dossier.components.map((c) => `- ${c.name}: ${c.role} [${c.paths.join(", ")}]`).join("\n")}`,
        `## Decisions\n${dossier.decisions.map((d) => `- ${d.decision} — ${d.rationale} (alternatives: ${d.alternatives.join(", ")}; trade-off: ${d.tradeoff})`).join("\n")}`,
        `## Weak spots\n${dossier.weakSpots.map((w) => `- [${w.severity}] ${w.issue} @ ${w.where.join(", ")} — ${w.why}`).join("\n")}`,
        `## Interview hotspots\n${dossier.hotspots.map((h, i) => `${i + 1}. [${h.difficulty}] ${h.title} @ ${h.paths.join(", ")} — ${h.whyInteresting} (angles: ${h.angles.join("; ")})`).join("\n")}`,
        `## Complexity\n${dossier.complexity} — ${dossier.complexityNote}`,
      ].join("\n\n"),
    ),
  ].join("\n");
}

export const version = "v1";

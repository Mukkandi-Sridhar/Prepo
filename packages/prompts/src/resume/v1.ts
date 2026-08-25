import type { RepoFacts, ResumeClaim } from "@prepo/shared";
import { INJECTION_NOTICE, truncate, untrusted } from "../lib.js";

export interface ExtractInput {
  resumeText: string;
  projectName: string;
}

export interface CheckInput {
  claims: ResumeClaim[];
  facts: RepoFacts;
  evidence: string;
}

export const extractSystem = `Extract the claims a candidate makes about one specific project on their resume.

A claim is anything an interviewer could ask them to substantiate: a technology used, a scale figure, an impact number, a role ("led", "designed", "owned"), an outcome.

For each: the claim as written, its kind, the keywords to match against a codebase, and how badly it would go if the code does not support it. A claimed technology that is absent is high risk — that is the kind of thing that ends an interview. A rounded impact number is lower risk.

Ignore lines about other projects, education, and skills lists not tied to this project.

${INJECTION_NOTICE}`;

export function extractUser(input: ExtractInput): string {
  return [
    `The project in question is: ${input.projectName}`,
    "",
    untrusted("resume", truncate(input.resumeText, 30_000)),
  ].join("\n");
}

/**
 * The uncomfortable half of the feature — and the reason it is worth building.
 * A candidate is far better served by finding out here that the repo does not
 * contain the Kafka pipeline their resume mentions.
 */
export const checkSystem = `Check each resume claim against what is actually in the repository.

For each claim decide whether the evidence supports it, cite what you found (or state plainly that you found nothing), and write one sentence of advice.

Be accurate rather than kind. If a candidate claims Redis caching and there is no Redis anywhere in the dependency list or the code, say so — they need to know before someone else asks. If a claim is about something a repository cannot show (team size, business impact), mark it unsupported and note that it is unverifiable from code rather than contradicted.

${INJECTION_NOTICE}`;

export function checkUser(input: CheckInput): string {
  return [
    untrusted("claims", input.claims.map((c) => `- [${c.kind}] ${c.claim}`).join("\n")),
    "",
    untrusted(
      "repo_facts",
      [
        `languages: ${input.facts.languages.map((l) => l.lang).join(", ")}`,
        `frameworks: ${input.facts.frameworks.join(", ")}`,
        `dependencies: ${input.facts.dependencies.map((d) => d.name).join(", ")}`,
        `tables: ${input.facts.tables.map((t) => t.name).join(", ")}`,
        `routes: ${input.facts.routes.length}`,
        `tests: ${input.facts.testFileCount} files`,
        `infra: docker=${input.facts.hasDockerfile} ci=${input.facts.ciProviders.join(",")} iac=${input.facts.iac.join(",")}`,
        `commits: ${input.facts.git.commits} by ${input.facts.git.contributors} contributor(s)`,
      ].join("\n"),
    ),
    "",
    untrusted("code_evidence", truncate(input.evidence, 40_000)),
  ].join("\n");
}

export const version = "v1";

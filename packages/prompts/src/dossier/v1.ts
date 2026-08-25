import type { RepoFacts } from "@prepo/shared";
import { INJECTION_NOTICE, truncate, untrusted } from "../lib.js";

export interface DossierInput {
  facts: RepoFacts;
  /** Directory path -> rolled-up summaries of the files beneath it. */
  rollups: Array<{ dir: string; summary: string }>;
}

/**
 * Stage 05. One frontier-tier call, and the highest-leverage prompt in the
 * product: every question generated downstream inherits the quality of this
 * output. It is worth spending the best model available here.
 *
 * The hotspots field is the part that matters. Anyone can summarise a repo;
 * the useful trick is identifying the ten places a good interviewer would
 * actually stop and push.
 */
export const system = `You are a staff engineer preparing to interview a candidate about a project they built. You have read the whole repository. Produce a structured dossier.

The facts block is machine-extracted and authoritative — dependency versions, routes, table names, file counts. Never contradict it, and never invent a fact of that kind that is not in it.

What matters most:

**hotspots** — the places you would actually stop and push on in an interview. Good hotspots are specific and have an answer worth hearing: a transaction boundary that looks wrong, an N+1 waiting to happen, a cache with no invalidation, an auth check in the wrong layer, a schema choice that will hurt at scale, a retry without idempotency. Bad hotspots are generic ("tell me about the frontend"). Rank them by how much they would reveal about the candidate.

**decisions** — choices the code visibly made, with the alternative it passed over. "Chose Postgres" is not a decision; "chose a relational store and normalised the event log rather than appending to a document store" is.

**weakSpots** — be direct. This is a preparation tool; the candidate benefits far more from knowing where they are exposed than from being flattered.

**complexity** — rate honestly. A CRUD todo app is "trivial", and saying so lets the rest of the system adapt instead of manufacturing depth that is not there.

Write in plain, concrete engineering English. No marketing register, no "leverages", no "robust".

${INJECTION_NOTICE}`;

export function user(input: DossierInput): string {
  const f = input.facts;

  const factLines = [
    `name: ${f.name}`,
    `commit: ${f.commitSha}`,
    `size: ${f.analysedFileCount} analysed files of ${f.fileCount}, ${f.totalLoc} LOC`,
    `languages: ${f.languages.map((l) => `${l.lang} ${(l.share * 100).toFixed(0)}%`).join(", ") || "none detected"}`,
    `frameworks: ${f.frameworks.join(", ") || "none detected"}`,
    `entrypoints: ${f.entrypoints.join(", ") || "none detected"}`,
    `routes: ${f.routes.length} (${f.routes.slice(0, 25).map((r) => `${r.method} ${r.path}`).join(", ")})`,
    `tables: ${f.tables.map((t) => `${t.name}(${t.columns.slice(0, 8).join(", ")})`).join(" · ") || "none detected"}`,
    `env vars: ${f.envVars.slice(0, 40).join(", ") || "none detected"}`,
    `docker: ${f.hasDockerfile ? "yes" : "no"}, compose: ${f.hasCompose ? "yes" : "no"}, ci: ${f.ciProviders.join(", ") || "none"}, iac: ${f.iac.join(", ") || "none"}`,
    `tests: ${f.testFileCount} files, frameworks: ${f.testFrameworks.join(", ") || "none detected"}`,
    `git: ${f.git.commits} commits by ${f.git.contributors} contributor(s)`,
    `churn hotspots: ${f.git.hotspots.slice(0, 10).map((h) => `${h.path}(${h.changes})`).join(", ") || "unknown"}`,
    `dependencies: ${f.dependencies.slice(0, 60).map((d) => `${d.name}@${d.version}`).join(", ")}`,
  ];

  const parts = [
    untrusted("facts", factLines.join("\n")),
    "",
    untrusted(
      "module_summaries",
      truncate(input.rollups.map((r) => `## ${r.dir}\n${r.summary}`).join("\n\n"), 200_000),
    ),
  ];

  if (f.readme) {
    parts.push("", untrusted("readme", truncate(f.readme, 12_000)));
  }

  return parts.join("\n");
}

export const version = "v1";

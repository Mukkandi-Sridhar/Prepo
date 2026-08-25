import { z } from "zod";

/**
 * RepoFacts is produced by stage 03 with zero LLM involvement — everything
 * here was parsed out of the repository, not inferred by a model.
 *
 * It gets injected verbatim into every downstream prompt. That is the single
 * most effective anti-hallucination measure in the pipeline: the model is
 * never asked which version of React the project uses, it is *told*.
 */

export const LanguageStat = z.object({
  lang: z.string(),
  files: z.number().int(),
  loc: z.number().int(),
  share: z.number(), // 0..1 of total analysed LOC
});
export type LanguageStat = z.infer<typeof LanguageStat>;

export const Dependency = z.object({
  ecosystem: z.string(), // npm | pypi | go | cargo | maven | gem | composer
  name: z.string(),
  version: z.string(),
  dev: z.boolean().default(false),
});
export type Dependency = z.infer<typeof Dependency>;

export const RouteFact = z.object({
  method: z.string(),
  path: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type RouteFact = z.infer<typeof RouteFact>;

export const TableFact = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  source: z.string(), // migration or schema file it came from
});
export type TableFact = z.infer<typeof TableFact>;

export const GitStats = z.object({
  commits: z.number().int(),
  contributors: z.number().int(),
  firstCommit: z.string().nullable(),
  lastCommit: z.string().nullable(),
  /** Files with the most churn — a good proxy for "where the work was". */
  hotspots: z.array(z.object({ path: z.string(), changes: z.number().int() })),
});
export type GitStats = z.infer<typeof GitStats>;

export const RepoFacts = z.object({
  name: z.string(),
  commitSha: z.string(),
  defaultBranch: z.string().nullable(),
  description: z.string().nullable(),

  fileCount: z.number().int(),
  analysedFileCount: z.number().int(),
  totalLoc: z.number().int(),
  sizeBytes: z.number().int(),

  languages: z.array(LanguageStat),
  frameworks: z.array(z.string()),
  dependencies: z.array(Dependency),

  entrypoints: z.array(z.string()),
  routes: z.array(RouteFact),
  tables: z.array(TableFact),
  envVars: z.array(z.string()),

  hasDockerfile: z.boolean(),
  hasCompose: z.boolean(),
  ciProviders: z.array(z.string()),
  iac: z.array(z.string()),
  testFrameworks: z.array(z.string()),
  testFileCount: z.number().int(),

  readme: z.string().nullable(),
  git: GitStats,

  /** Set when the repo was too large and the user scoped it down. */
  scopedModules: z.array(z.string()).default([]),
});
export type RepoFacts = z.infer<typeof RepoFacts>;

export const RedactionReport = z.object({
  scanned: z.number().int(),
  findings: z.array(
    z.object({
      rule: z.string(),
      path: z.string(),
      line: z.number().int(),
      preview: z.string(), // already masked
    }),
  ),
});
export type RedactionReport = z.infer<typeof RedactionReport>;

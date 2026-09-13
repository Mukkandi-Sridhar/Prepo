/**
 * Prepo eval runner.
 *
 * `pnpm eval` — the default, and what CI runs on every PR touching
 * `packages/prompts` or `packages/engine`. Exercises stages 02–03 (filter,
 * redact, extract facts) against the local fixtures in `evals/fixtures/local`.
 * No network, no API key, no Postgres. It cannot tell you whether the model
 * output is good — only that the deterministic half of the pipeline still
 * works. That is a real, useful, always-available signal, and it is honest
 * about being a smaller one than "quality evaluation suite" implies.
 *
 * `pnpm eval:full` — opt-in, costs real tokens. Requires DATABASE_URL and a
 * configured model provider. Runs the actual pipeline (`runPipeline`) against
 * the remote fixtures in `evals/fixtures.ts` and scores the real output with
 * the functions in `scorers.ts` — the ones that were previously fed
 * hand-written numbers instead of anything the pipeline produced.
 *
 * Neither mode fabricates a result. A gate that cannot run is reported as
 * skipped, with the reason, not as a passing number.
 */
import fs from "node:fs";
import path from "node:path";
import { collect, extractFacts } from "@prepo/engine";
import { LOCAL_FIXTURES, REMOTE_FIXTURES } from "./fixtures.js";
import {
  scoreCategoryCoverage,
  scoreCitationValidity,
  scoreDuplicateRate,
  scoreGroundedness,
  type EvaluatedQuestion,
  type MetricResult,
} from "./scorers.js";

const FULL = process.argv.includes("--full");

interface SmokeResult {
  id: string;
  ok: boolean;
  files: number;
  languages: string[];
  redactionFindings: number;
  problems: string[];
}

async function runSmokeSuite(): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];

  for (const fixture of LOCAL_FIXTURES) {
    const problems: string[] = [];

    if (!fs.existsSync(fixture.dir)) {
      results.push({ id: fixture.id, ok: false, files: 0, languages: [], redactionFindings: 0, problems: [`fixture directory missing: ${fixture.dir}`] });
      continue;
    }

    const collected = await collect(fixture.dir);
    const facts = extractFacts({
      name: fixture.id,
      commitSha: "local",
      defaultBranch: null,
      git: { commits: 0, contributors: 0, firstCommit: null, lastCommit: null, hotspots: [] },
      collected,
    });

    if (collected.files.length < fixture.expect.minFiles) {
      problems.push(`expected >= ${fixture.expect.minFiles} files, found ${collected.files.length}`);
    }

    const foundLangs = new Set(facts.languages.map((l) => l.lang));
    for (const lang of fixture.expect.languages) {
      if (!foundLangs.has(lang)) problems.push(`expected language "${lang}" not detected`);
    }

    if (fixture.expect.expectRedaction && collected.redaction.findings.length === 0) {
      problems.push("expected a planted secret to be redacted, but stage 02 found nothing");
    }

    results.push({
      id: fixture.id,
      ok: problems.length === 0,
      files: collected.files.length,
      languages: [...foundLangs],
      redactionFindings: collected.redaction.findings.length,
      problems,
    });
  }

  return results;
}

async function runFullSuite(): Promise<{ metrics: MetricResult[]; skippedReason?: string; perRepo: string[] }> {
  if (!process.env.DATABASE_URL) {
    return { metrics: [], skippedReason: "DATABASE_URL is not set — pnpm eval:full needs a running Postgres.", perRepo: [] };
  }

  const { providersAvailableFromEnv } = await import("@prepo/llm");
  if (providersAvailableFromEnv().length === 0) {
    return {
      metrics: [],
      skippedReason: "No model provider configured — set ANTHROPIC_API_KEY (or another provider) to run the full suite.",
      perRepo: [],
    };
  }

  const { getDb, projects, jobs, users, eq } = await import("@prepo/db");
  const { CostMeter, createEmbedder, createLlmClient } = await import("@prepo/llm");
  const { resolveCredentials, runPipeline } = await import("@prepo/engine");

  const db = getDb();
  const perRepo: string[] = [];
  const allQuestions: EvaluatedQuestion[] = [];
  const fileLinesMap = new Map<string, number>();

  const [runner] = await db
    .insert(users)
    .values({ email: "eval-runner@prepo.localhost", name: "eval runner" })
    .onConflictDoUpdate({ target: users.email, set: {} })
    .returning({ id: users.id });

  for (const fixture of REMOTE_FIXTURES) {
    const [project] = await db
      .insert(projects)
      .values({ ownerId: runner!.id, name: fixture.name, sourceType: "git", sourceUrl: fixture.url })
      .returning({ id: projects.id });

    const [job] = await db
      .insert(jobs)
      .values({ projectId: project!.id, userId: runner!.id, kind: "analyze", state: "running", budgetCents: 300 })
      .returning({ id: jobs.id });

    const meter = new CostMeter(300);
    const credentials = await resolveCredentials(db, runner!.id);
    const llm = createLlmClient(credentials, meter, createEmbedder());

    try {
      const result = await runPipeline(
        {
          db,
          llm,
          userId: runner!.id,
          jobId: job!.id,
          async onProgress(stage, fraction) {
            process.stdout.write(`\r  ${fixture.id}: ${stage} ${(fraction * 100).toFixed(0)}%   `);
          },
        },
        { projectId: project!.id, jobId: job!.id, sourceType: "git", sourceUrl: fixture.url },
      );
      process.stdout.write("\n");

      perRepo.push(
        `${fixture.id}: ${result.questionCount} kept, ${result.droppedCount} dropped, $${(result.costCents / 100).toFixed(2)}`,
      );

      const rows = await db.query.questions.findMany({
        where: (t, { eq: equals }) => equals(t.setId, result.questionSetId),
        with: { citations: true },
      });

      for (const row of rows) {
        allQuestions.push({
          category: row.category,
          stem: row.stem,
          groundedness: Number(row.groundedness),
          citations: row.citations.map((c) => ({ path: c.path, startLine: c.startLine, endLine: c.endLine, symbol: c.symbol })),
        });
        for (const c of row.citations) {
          fileLinesMap.set(c.path, Math.max(fileLinesMap.get(c.path) ?? 0, c.endLine));
        }
      }
    } catch (err) {
      perRepo.push(`${fixture.id}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await db.update(jobs).set({ state: "done" }).where(eq(jobs.id, job!.id));
    }
  }

  if (allQuestions.length === 0) {
    return { metrics: [], skippedReason: "Every fixture run failed — see perRepo detail.", perRepo };
  }

  const metrics: MetricResult[] = [
    scoreCitationValidity(allQuestions, fileLinesMap),
    scoreGroundedness(allQuestions),
    scoreCategoryCoverage(allQuestions),
    scoreDuplicateRate(allQuestions),
  ];

  return { metrics, perRepo };
}

async function main() {
  console.log("=================================================");
  console.log("  PREPO EVAL SUITE");
  console.log("=================================================\n");

  console.log(`Smoke suite (stages 02–03, no network, no API key) — ${LOCAL_FIXTURES.length} local fixtures\n`);
  const smoke = await runSmokeSuite();

  let smokeOk = true;
  for (const r of smoke) {
    const symbol = r.ok ? "✅ PASS" : "❌ FAIL";
    if (!r.ok) smokeOk = false;
    console.log(`${symbol}  ${r.id}  — ${r.files} files, languages: ${r.languages.join(", ") || "none"}, ${r.redactionFindings} secret(s) redacted`);
    for (const p of r.problems) console.log(`   └─ ${p}`);
  }

  let full: Awaited<ReturnType<typeof runFullSuite>> | null = null;
  if (FULL) {
    console.log("\n-------------------------------------------------");
    console.log(`Full suite (real pipeline, real tokens) — ${REMOTE_FIXTURES.length} remote fixtures\n`);
    full = await runFullSuite();

    if (full.skippedReason) {
      console.log(`⏭️  SKIPPED — ${full.skippedReason}`);
    } else {
      for (const line of full.perRepo) console.log(`  ${line}`);
      console.log();
      for (const m of full.metrics) {
        console.log(`${m.passed ? "✅ PASS" : "❌ FAIL"}  ${m.metric.padEnd(24)}: ${m.score} ${m.unit ?? ""} (gate: ${m.passed ? ">=" : "<"} ${m.threshold})`);
        if (m.details) console.log(`   └─ ${m.details}`);
      }
    }
  } else {
    console.log("\n(full suite skipped — run `pnpm eval:full` with DATABASE_URL and a model key configured to exercise real generation)");
  }

  const fullPassed = full && !full.skippedReason ? full.metrics.every((m) => m.passed) : true;
  const overallPassed = smokeOk && fullPassed;

  console.log("\n-------------------------------------------------");
  console.log(`OVERALL: ${overallPassed ? "PASSED ✅" : "FAILED ❌"}`);
  console.log("-------------------------------------------------\n");

  writeReport(smoke, full);

  if (!overallPassed) process.exit(1);
}

function writeReport(
  smoke: SmokeResult[],
  full: Awaited<ReturnType<typeof runFullSuite>> | null,
): void {
  const lines: string[] = [
    "# Prepo Eval Suite Report",
    "",
    `**Run at:** ${new Date().toISOString()}`,
    "",
    "This report reflects what actually ran. The smoke suite runs stages 02–03",
    "(filter, redact, extract facts) against real local fixtures — no network,",
    "no API key. It cannot evaluate generated question quality; only",
    "`pnpm eval:full`, with a real database and model key, exercises the full",
    "pipeline and scores real output.",
    "",
    "## Smoke suite",
    "",
    "| Fixture | Result | Files | Languages | Secrets redacted |",
    "| :--- | :--- | :--- | :--- | :--- |",
    ...smoke.map(
      (r) => `| \`${r.id}\` | ${r.ok ? "✅ PASS" : "❌ FAIL"} | ${r.files} | ${r.languages.join(", ") || "—"} | ${r.redactionFindings} |`,
    ),
  ];

  if (smoke.some((r) => r.problems.length > 0)) {
    lines.push("", "**Problems:**", "");
    for (const r of smoke) for (const p of r.problems) lines.push(`- \`${r.id}\`: ${p}`);
  }

  lines.push("", "## Full suite", "");

  if (!full) {
    lines.push("Not run this time — invoke with `pnpm eval:full`.");
  } else if (full.skippedReason) {
    lines.push(`Skipped: ${full.skippedReason}`);
  } else {
    lines.push(
      "| Metric | Result | Threshold | Status | Details |",
      "| :--- | :--- | :--- | :--- | :--- |",
      ...full.metrics.map(
        (m) => `| **${m.metric}** | ${m.score} ${m.unit ?? ""} | ${m.threshold} ${m.unit ?? ""} | ${m.passed ? "✅ PASS" : "❌ FAIL"} | ${m.details ?? ""} |`,
      ),
      "",
      "**Per-repository:**",
      "",
      ...full.perRepo.map((l) => `- ${l}`),
    );
  }

  const reportPath = path.join(process.cwd(), "evals", "report.md");
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf-8");
  console.log(`Report written to ${reportPath}`);
}

main().catch((err) => {
  console.error("Eval runner error:", err);
  process.exit(1);
});

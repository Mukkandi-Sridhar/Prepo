import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, getDb, projects, questionSets, repoSnapshots } from "@prepo/db";
import { currentUser } from "@/lib/auth";
import { JobProgress } from "@/components/job-progress";
import { QuestionList, type QuestionView } from "@/components/question-list";
import { RepoCard } from "@/components/repo-card";
import { RegenerateButton, AddToDeckButton } from "@/components/project-actions";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const { job: jobId } = await searchParams;
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.userId)),
  });
  if (!project) notFound();

  const snapshot = await db.query.repoSnapshots.findFirst({
    where: eq(repoSnapshots.projectId, project.id),
    orderBy: [desc(repoSnapshots.createdAt)],
  });

  const set = snapshot
    ? await db.query.questionSets.findFirst({
        where: eq(questionSets.snapshotId, snapshot.id),
        orderBy: [desc(questionSets.createdAt)],
      })
    : null;

  const rows = set
    ? await db.query.questions.findMany({
        where: (q, { eq: equals }) => equals(q.setId, set.id),
        orderBy: (q, { desc: descending }) => [descending(q.rank)],
        with: { citations: true },
      })
    : [];

  const questions: QuestionView[] = rows.map((q) => ({
    id: q.id,
    category: q.category,
    difficulty: q.difficulty,
    persona: q.persona,
    stem: q.stem,
    modelAnswer: q.modelAnswer,
    probes: q.probes ?? [],
    testingFor: q.testingFor,
    redFlags: q.redFlags ?? [],
    groundedness: Number(q.groundedness),
    citations: q.citations.map((c) => ({ path: c.path, startLine: c.startLine, endLine: c.endLine })),
  }));

  const facts = snapshot?.repoFacts ?? null;
  const redaction = snapshot?.redactionReport ?? null;

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          {project.sourceType === "git" ? "Repository" : "Uploaded archive"}
          {snapshot && <> · commit {snapshot.commitSha.slice(0, 10)}</>}
        </div>
        <h1 className="title">{project.name}</h1>
        {project.sourceUrl && (
          <p className="lede mono" style={{ fontSize: ".82rem" }}>
            {project.sourceUrl}
          </p>
        )}
      </div>

      {jobId && <JobProgress jobId={jobId} />}

      {facts && <RepoCard facts={facts} redaction={redaction} />}

      {set && questions.length > 0 ? (
        <section style={{ marginTop: "2.5rem" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.3rem" }}>Your prep pack</h2>
              <p className="small muted" style={{ margin: ".25rem 0 0" }}>
                {set.questionCount} kept · {set.droppedCount} dropped in verification · every answer cites its source
              </p>
            </div>

            <div className="row" style={{ gap: ".4rem" }}>
              <Link className="btn ghost small" href={`/projects/${project.id}/interview`}>
                Start mock interview
              </Link>
              <AddToDeckButton setId={set.id} />
              <Link className="btn ghost small" href={`/api/export/${set.id}?format=md`}>
                Markdown
              </Link>
              <Link className="btn ghost small" href={`/api/export/${set.id}?format=html`} target="_blank">
                PDF
              </Link>
              <Link className="btn ghost small" href={`/api/export/${set.id}?format=anki`}>
                Anki
              </Link>
            </div>
          </div>

          <QuestionList questions={questions} />
        </section>
      ) : (
        !jobId && (
          <div className="empty" style={{ marginTop: "2rem" }}>
            <h3>No pack yet</h3>
            <p>Run the analysis to generate the interview questions for this project.</p>
            <div style={{ marginTop: "1rem" }}>
              <RegenerateButton projectId={project.id} label="Generate the pack" />
            </div>
          </div>
        )
      )}

      {set && (
        <div className="row" style={{ marginTop: "2.5rem", justifyContent: "space-between" }}>
          <RegenerateButton projectId={project.id} label="Re-run analysis" ghost />
          <span className="small muted">
            Re-running reuses the cached analysis when the commit hasn&apos;t changed.
          </span>
        </div>
      )}
    </>
  );
}

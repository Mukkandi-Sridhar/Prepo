import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, dossiers, eq, getDb, projects, questionSets, repoSnapshots } from "@prepo/db";
import { currentUser } from "@/lib/auth";
import { InterviewRoom } from "@/components/interview-room";

export const dynamic = "force-dynamic";

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const { id } = await params;
  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.ownerId, user.userId)),
  });
  if (!project) notFound();

  const snapshot = await db.query.repoSnapshots.findFirst({
    where: eq(repoSnapshots.projectId, project.id),
    orderBy: [desc(repoSnapshots.createdAt)],
  });

  const ready =
    snapshot &&
    (await db.query.dossiers.findFirst({ where: eq(dossiers.snapshotId, snapshot.id) })) &&
    (await db.query.questionSets.findFirst({ where: eq(questionSets.snapshotId, snapshot.id) }));

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Mock interview</div>
        <h1 className="title">{project.name}</h1>
        <p className="lede">
          The interviewer has read your code and has a plan. It will follow up on whatever you leave vague — and it
          scores honesty about limits <em>higher</em> than bluffing, so say &ldquo;I don&apos;t know&rdquo; when you
          don&apos;t.
        </p>
      </div>

      {ready ? (
        <InterviewRoom projectId={project.id} />
      ) : (
        <div className="empty">
          <h3>No pack yet</h3>
          <p>
            Generate the prep pack first — the interviewer works from the same dossier.{" "}
            <Link href={`/projects/${project.id}`}>Back to the project</Link>
          </p>
        </div>
      )}
    </>
  );
}

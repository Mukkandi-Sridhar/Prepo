import Link from "next/link";
import { desc, eq, getDb, projects, questionSets, repoSnapshots } from "@prepo/db";
import { config } from "@prepo/shared";
import { availableProviders } from "@prepo/engine";
import { currentUser } from "@/lib/auth";
import { NewProjectForm } from "@/components/new-project-form";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const db = getDb();
  const [mine, providers] = await Promise.all([
    db.query.projects.findMany({
      where: eq(projects.ownerId, user.userId),
      orderBy: [desc(projects.createdAt)],
      limit: 40,
    }),
    availableProviders(db, user.userId),
  ]);

  // One query for the pack counts rather than N — the dashboard is the page
  // people load most often.
  const snapshots = await db
    .select({
      projectId: repoSnapshots.projectId,
      snapshotId: repoSnapshots.id,
      setId: questionSets.id,
      count: questionSets.questionCount,
      commitSha: repoSnapshots.commitSha,
    })
    .from(repoSnapshots)
    .leftJoin(questionSets, eq(questionSets.snapshotId, repoSnapshots.id))
    .orderBy(desc(repoSnapshots.createdAt));

  const latestBySnapshot = new Map<string, (typeof snapshots)[number]>();
  for (const row of snapshots) {
    if (!latestBySnapshot.has(row.projectId)) latestBySnapshot.set(row.projectId, row);
  }

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Your repo, cross-examined</div>
        <h1 className="title">What are you being interviewed about?</h1>
        <p className="lede">
          Paste the repository that&apos;s on your resume. Prepo reads the code, builds a dossier, and writes the
          questions you&apos;ll actually be asked — with every answer citing the lines it came from.
        </p>
      </div>

      {providers.length === 0 && (
        <div className="notice warn" style={{ marginBottom: "1.5rem" }}>
          <span className="label">No model provider configured</span>
          <p style={{ margin: 0 }}>
            Add an API key in <Link href="/settings">Settings</Link>, or point <code>OLLAMA_BASE_URL</code> at a local
            model. You can still add a project — the Repo Card works without a key.
          </p>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: "2rem" }}>
        <NewProjectForm />

        <section>
          <h2 style={{ fontSize: "1.15rem", marginBottom: ".9rem" }}>Your projects</h2>

          {mine.length === 0 ? (
            <div className="empty">
              <h3>Nothing here yet</h3>
              <p style={{ margin: 0 }}>Add the first repository above and you&apos;ll have a prep pack in a few minutes.</p>
            </div>
          ) : (
            <div className="grid two">
              {mine.map((project) => {
                const latest = latestBySnapshot.get(project.id);
                return (
                  <Link key={project.id} href={`/projects/${project.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
                    <div className="card-pad">
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <span className="chip">{project.sourceType === "git" ? "git" : "upload"}</span>
                        {latest?.count ? (
                          <span className="chip accent">{latest.count} questions</span>
                        ) : (
                          <span className="chip">not analysed</span>
                        )}
                      </div>

                      <h3 style={{ fontSize: "1.05rem", margin: ".7rem 0 .25rem" }}>{project.name}</h3>
                      <div className="mono muted">
                        {latest?.commitSha ? latest.commitSha.slice(0, 10) : "—"} ·{" "}
                        {project.createdAt.toISOString().slice(0, 10)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {config.singleUserMode && (
        <p className="small muted" style={{ marginTop: "2.5rem" }}>
          Running in single-user mode — no accounts, everything stays on this machine. Set{" "}
          <code>SINGLE_USER_MODE=false</code> to enable sign-in.
        </p>
      )}
    </>
  );
}

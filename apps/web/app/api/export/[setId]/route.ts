import { desc, eq, getDb, projects, questionSets, repoSnapshots } from "@prepo/db";
import { toAnkiTsv, toMarkdown, toPrintableHtml, type ExportQuestion } from "@prepo/engine";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ setId: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { setId } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "md";
  const db = getDb();

  const set = await db.query.questionSets.findFirst({ where: eq(questionSets.id, setId) });
  if (!set) return new Response("Not found", { status: 404 });

  const snapshot = await db.query.repoSnapshots.findFirst({
    where: eq(repoSnapshots.id, set.snapshotId),
  });
  const project = snapshot
    ? await db.query.projects.findFirst({ where: eq(projects.id, snapshot.projectId) })
    : null;

  // Ownership is checked through the project, not the set — a set id alone
  // must never be enough to read someone else's pack.
  if (!project || project.ownerId !== user.userId) {
    return new Response("Not found", { status: 404 });
  }

  const rows = await db.query.questions.findMany({
    where: (q, { eq: equals }) => equals(q.setId, setId),
    orderBy: (q, { desc: descending }) => [descending(q.rank)],
    with: { citations: true },
  });

  const questions: ExportQuestion[] = rows.map((q) => ({
    category: q.category,
    difficulty: q.difficulty,
    persona: q.persona,
    stem: q.stem,
    modelAnswer: q.modelAnswer,
    probes: q.probes ?? [],
    testingFor: q.testingFor,
    redFlags: q.redFlags ?? [],
    groundedness: q.groundedness,
    citations: q.citations.map((c) => ({ path: c.path, startLine: c.startLine, endLine: c.endLine })),
  }));

  const input = {
    projectName: project.name,
    commitSha: snapshot!.commitSha,
    generatedAt: set.createdAt,
    questions,
    droppedCount: set.droppedCount,
  };

  const slug = project.name.replace(/[^\w.-]+/g, "-").toLowerCase();

  switch (format) {
    case "anki":
      return file(toAnkiTsv(input), "text/plain; charset=utf-8", `${slug}-anki.txt`);
    case "html":
      // Opened in a tab so the browser's own print-to-PDF does the work —
      // no headless Chromium in the image for something every user has.
      return new Response(toPrintableHtml(input), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    default:
      return file(toMarkdown(input), "text/markdown; charset=utf-8", `${slug}-prep.md`);
  }
}

function file(body: string, contentType: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

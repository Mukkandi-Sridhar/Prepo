import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  desc,
  dossiers,
  eq,
  getDb,
  practiceSessions,
  projects,
  questionSets,
  repoSnapshots,
  turns,
} from "@prepo/db";
import { InterviewMode, PrepoError, toPublicError } from "@prepo/shared";
import { planInterview } from "@prepo/engine";
import { requireUser } from "@/lib/auth";
import { requestContext } from "@/lib/llm-context";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({
  projectId: z.string().uuid(),
  mode: InterviewMode.default("standard"),
});

/** Starts a session: builds the interviewer's plan and returns the opening line. */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const body = Body.parse(await request.json());
    const db = getDb();

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, body.projectId), eq(projects.ownerId, user.userId)),
    });
    if (!project) throw new PrepoError("not_found", "Project not found.");

    const snapshot = await db.query.repoSnapshots.findFirst({
      where: eq(repoSnapshots.projectId, project.id),
      orderBy: [desc(repoSnapshots.createdAt)],
    });
    if (!snapshot) throw new PrepoError("invalid_input", "Analyse this project before starting an interview.");

    const [dossier, set] = await Promise.all([
      db.query.dossiers.findFirst({ where: eq(dossiers.snapshotId, snapshot.id) }),
      db.query.questionSets.findFirst({
        where: eq(questionSets.snapshotId, snapshot.id),
        orderBy: [desc(questionSets.createdAt)],
      }),
    ]);

    if (!dossier || !set) throw new PrepoError("invalid_input", "This project has no prep pack yet.");

    const ctx = await requestContext(user.userId);
    const plan = await planInterview(ctx, {
      dossier: dossier.content,
      mode: body.mode,
      projectName: project.name,
    });

    const [session] = await db
      .insert(practiceSessions)
      .values({ userId: user.userId, setId: set.id, mode: body.mode, plan, state: "active" })
      .returning({ id: practiceSessions.id });

    await db.insert(turns).values({
      sessionId: session!.id,
      idx: 0,
      role: "interviewer",
      content: plan.opening,
      move: "advance",
      beatIndex: 0,
    });

    return NextResponse.json({
      sessionId: session!.id,
      snapshotId: snapshot.id,
      opening: plan.opening,
      beats: plan.beats.length,
      persona: plan.persona,
    });
  } catch (err) {
    const publicError = toPublicError(err);
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}

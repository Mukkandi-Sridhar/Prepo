import { NextResponse } from "next/server";
import { z } from "zod";
import {
  and,
  asc,
  eq,
  evaluations,
  getDb,
  practiceSessions,
  questionSets,
  repoSnapshots,
  turns,
} from "@prepo/db";
import { InterviewPlan, MODE_CONFIG, PrepoError, toPublicError } from "@prepo/shared";
import { nextTurn, scoreInterview } from "@prepo/engine";
import { requireUser } from "@/lib/auth";
import { requestContext } from "@/lib/llm-context";

export const runtime = "nodejs";
export const maxDuration = 180;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), text: z.string().min(1).max(8_000) }),
  z.object({ action: z.literal("finish") }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = Body.parse(await request.json());
    const db = getDb();

    const session = await db.query.practiceSessions.findFirst({
      where: and(eq(practiceSessions.id, id), eq(practiceSessions.userId, user.userId)),
    });
    if (!session) throw new PrepoError("not_found", "Session not found.");

    const set = await db.query.questionSets.findFirst({ where: eq(questionSets.id, session.setId) });
    const snapshot = set
      ? await db.query.repoSnapshots.findFirst({ where: eq(repoSnapshots.id, set.snapshotId) })
      : null;
    if (!snapshot) throw new PrepoError("not_found", "The project behind this session is gone.");

    const history = await db.query.turns.findMany({
      where: eq(turns.sessionId, session.id),
      orderBy: [asc(turns.idx)],
    });

    const plan = InterviewPlan.parse(session.plan);
    const transcript = history.map((t) => ({ role: t.role, content: t.content }));
    const ctx = await requestContext(user.userId);
    const projectName = snapshot.repoFacts?.name ?? "this project";

    /* ── finish ────────────────────────────────────────────── */

    if (body.action === "finish" || session.state === "finished") {
      const existing = await db.query.evaluations.findFirst({
        where: eq(evaluations.sessionId, session.id),
      });
      if (existing) return NextResponse.json({ done: true, evaluation: existing.result });

      const evaluation = await scoreInterview(ctx, { plan, transcript, projectName });

      await db.insert(evaluations).values({ sessionId: session.id, result: evaluation });
      await db
        .update(practiceSessions)
        .set({ state: "finished", finishedAt: new Date() })
        .where(eq(practiceSessions.id, session.id));

      return NextResponse.json({ done: true, evaluation });
    }

    /* ── answer → next turn ────────────────────────────────── */

    const nextIdx = history.length;
    await db.insert(turns).values({
      sessionId: session.id,
      idx: nextIdx,
      role: "candidate",
      content: body.text,
    });

    transcript.push({ role: "candidate", content: body.text });

    const turn = await nextTurn(ctx, {
      snapshotId: snapshot.id,
      plan,
      transcript,
      mode: session.mode,
    });

    await db.insert(turns).values({
      sessionId: session.id,
      idx: nextIdx + 1,
      role: "interviewer",
      content: turn.say,
      move: turn.move,
      beatIndex: turn.beatIndex,
    });

    const answered = transcript.filter((t) => t.role === "candidate").length;

    return NextResponse.json({
      say: turn.say,
      move: turn.move,
      turnsRemaining: Math.max(0, MODE_CONFIG[session.mode].turns - answered),
      wrapped: turn.move === "wrap",
    });
  } catch (err) {
    const publicError = toPublicError(err);
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}

/** Full transcript, for reloading a session. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await params;
    const db = getDb();

    const session = await db.query.practiceSessions.findFirst({
      where: and(eq(practiceSessions.id, id), eq(practiceSessions.userId, user.userId)),
    });
    if (!session) throw new PrepoError("not_found", "Session not found.");

    const [history, evaluation] = await Promise.all([
      db.query.turns.findMany({ where: eq(turns.sessionId, id), orderBy: [asc(turns.idx)] }),
      db.query.evaluations.findFirst({ where: eq(evaluations.sessionId, id) }),
    ]);

    return NextResponse.json({
      state: session.state,
      transcript: history.map((t) => ({ role: t.role, content: t.content })),
      evaluation: evaluation?.result ?? null,
    });
  } catch (err) {
    const publicError = toPublicError(err);
    return NextResponse.json({ error: publicError.message }, { status: publicError.status });
  }
}

export const dynamic = "force-dynamic";

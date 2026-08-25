import { eq, getDb, jobs, questionSets, subscribeJobs, type JobProgress } from "@prepo/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events over Postgres LISTEN/NOTIFY.
 *
 * No websocket server, no polling loop, and — the part that matters — it works
 * across multiple web replicas, because the worker publishes to the database
 * rather than to whichever process happens to hold this connection.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();

  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
  if (!job || job.userId !== user.userId) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: JobProgress) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Replay current state immediately — a client that connects late, or
      // reconnects, must not sit on an empty progress bar.
      const set =
        job.state === "done" && job.snapshotId
          ? await db.query.questionSets.findFirst({
              where: eq(questionSets.snapshotId, job.snapshotId),
              orderBy: (s, { desc }) => [desc(s.createdAt)],
            })
          : null;

      send({
        jobId: job.id,
        state: job.state,
        stage: job.stage,
        progress: job.progress,
        error: job.error ?? undefined,
        spentCents: job.spentCents,
        questionSetId: set?.id,
      });

      if (job.state === "done" || job.state === "failed") {
        controller.close();
        return;
      }

      const unsubscribe = await subscribeJobs((event) => {
        if (event.jobId !== id) return;
        send(event);
        if (event.state === "done" || event.state === "failed") {
          void cleanup();
        }
      });

      // Comment frames keep proxies from closing an idle connection.
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            void cleanup();
          }
        }
      }, 20_000);

      async function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        await unsubscribe().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }

      request.signal.addEventListener("abort", () => void cleanup());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

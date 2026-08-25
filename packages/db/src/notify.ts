import { getSql } from "./index.js";

export interface JobProgress {
  jobId: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  note?: string;
  error?: string;
  spentCents?: number;
  questionSetId?: string;
}

const CHANNEL = "prepo_job";

/**
 * Progress rides on Postgres LISTEN/NOTIFY rather than in-process state, which
 * is the one detail that lets the web tier scale past a single replica: an SSE
 * connection on replica A receives progress from a worker on host B without
 * any shared memory, message broker, or sticky sessions.
 */
export async function notifyJob(progress: JobProgress): Promise<void> {
  const sql = getSql();
  const payload = JSON.stringify(progress);

  // NOTIFY payloads are capped at 8000 bytes; nothing here should come close,
  // but a truncated note is better than a dropped update.
  await sql`SELECT pg_notify(${CHANNEL}, ${payload.slice(0, 7_900)})`;
}

/**
 * Subscribes to job progress. Returns an unsubscribe function.
 * Uses a dedicated connection — postgres.js requires one for LISTEN.
 */
export async function subscribeJobs(
  onProgress: (progress: JobProgress) => void,
): Promise<() => Promise<void>> {
  const sql = getSql();

  const subscription = await sql.listen(CHANNEL, (payload) => {
    try {
      onProgress(JSON.parse(payload) as JobProgress);
    } catch {
      // A malformed payload is not worth taking the stream down for.
    }
  });

  return async () => {
    await subscription.unlisten();
  };
}

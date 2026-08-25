import PgBoss from "pg-boss";

export const ANALYZE_QUEUE = "analyze";

export interface AnalyzeJob {
  jobId: string;
  projectId: string;
  userId: string;
  sourceType: "git" | "zip";
  sourceUrl?: string;
  zipPath?: string;
  scopedModules?: string[];
  resumeId?: string;
  roleId?: string;
  budgetCents?: number;
}

let boss: PgBoss | undefined;

/**
 * pg-boss on the same Postgres, rather than Redis + BullMQ.
 *
 * The win is not one fewer container (though that matters for a project whose
 * pitch is `docker compose up`). It is that enqueueing a job and writing the
 * row it refers to happen in the same transaction, so there is no window where
 * a job exists for a record that does not.
 */
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  boss = new PgBoss({
    connectionString,
    schema: "pgboss",
    retryLimit: 1,
    retryDelay: 30,
    expireInMinutes: 45,
    deleteAfterDays: 7,
  });

  boss.on("error", (err) => console.error("[queue]", err.message));
  await boss.start();
  await boss.createQueue(ANALYZE_QUEUE);
  return boss;
}

export async function enqueueAnalyze(job: AnalyzeJob): Promise<string | null> {
  const instance = await getBoss();
  return instance.send(ANALYZE_QUEUE, job, { singletonKey: job.jobId, expireInMinutes: 45 });
}

export async function stopBoss(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 30_000 });
  boss = undefined;
}

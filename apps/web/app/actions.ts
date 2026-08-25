"use server";

import { writeFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  and,
  eq,
  getDb,
  jobs,
  projects,
  providerKeys,
  resumes,
  reviews,
  srsCards,
  targetRoles,
} from "@prepo/db";
import { config, last4, PrepoError, seal, toPublicError } from "@prepo/shared";
import { createProvider, PROVIDERS, type ProviderId } from "@prepo/llm";
import { assertSafeRepoUrl, repoNameFromUrl, review as scheduleReview, tempZipPath } from "@prepo/engine";
import { enqueueAnalyze } from "@prepo/worker/queue";
import { requireUser } from "@/lib/auth";

export interface ActionState {
  error?: string;
  ok?: string;
}

/* ── projects ───────────────────────────────────────────────── */

export async function createProject(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const db = getDb();

    const url = String(form.get("url") ?? "").trim();
    const file = form.get("zip");
    const hasZip = file instanceof File && file.size > 0;

    if (!url && !hasZip) {
      return { error: "Paste a repository URL or choose a .zip file." };
    }

    let zipPath: string | undefined;
    let name: string;

    if (hasZip) {
      if (file.size > config.limits.maxRepoBytes) {
        return { error: `That archive is larger than ${Math.round(config.limits.maxRepoBytes / 1024 / 1024)} MB.` };
      }
      zipPath = await tempZipPath();
      await writeFile(zipPath, Buffer.from(await file.arrayBuffer()));
      name = file.name.replace(/\.zip$/i, "");
    } else {
      assertSafeRepoUrl(url);
      name = repoNameFromUrl(url);
    }

    const [project] = await db
      .insert(projects)
      .values({
        ownerId: user.userId,
        name,
        sourceType: hasZip ? "zip" : "git",
        sourceUrl: hasZip ? null : url,
        visibility: "public",
      })
      .returning({ id: projects.id });

    const jobId = await startJob({
      projectId: project!.id,
      userId: user.userId,
      sourceType: hasZip ? "zip" : "git",
      sourceUrl: hasZip ? undefined : url,
      zipPath,
      resumeId: (form.get("resumeId") as string) || undefined,
      roleId: (form.get("roleId") as string) || undefined,
    });

    redirect(`/projects/${project!.id}?job=${jobId}`);
  } catch (err) {
    // redirect() throws by design; let it through.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return { error: toPublicError(err).message };
  }
}

export async function regenerate(projectId: string, modules?: string[]): Promise<ActionState> {
  try {
    const user = await requireUser();
    const db = getDb();

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, projectId), eq(projects.ownerId, user.userId)),
    });
    if (!project) throw new PrepoError("not_found", "Project not found.");

    const jobId = await startJob({
      projectId,
      userId: user.userId,
      sourceType: project.sourceType,
      sourceUrl: project.sourceUrl ?? undefined,
      scopedModules: modules,
    });

    revalidatePath(`/projects/${projectId}`);
    return { ok: jobId };
  } catch (err) {
    return { error: toPublicError(err).message };
  }
}

async function startJob(input: {
  projectId: string;
  userId: string;
  sourceType: "git" | "zip";
  sourceUrl?: string;
  zipPath?: string;
  scopedModules?: string[];
  resumeId?: string;
  roleId?: string;
}): Promise<string> {
  const db = getDb();

  const [job] = await db
    .insert(jobs)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      kind: "analyze",
      state: "queued",
      budgetCents: config.limits.budgetCentsPerRun,
      options: { scopedModules: input.scopedModules ?? [] },
    })
    .returning({ id: jobs.id });

  await enqueueAnalyze({
    jobId: job!.id,
    projectId: input.projectId,
    userId: input.userId,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    zipPath: input.zipPath,
    scopedModules: input.scopedModules,
    resumeId: input.resumeId,
    roleId: input.roleId,
    budgetCents: config.limits.budgetCentsPerRun,
  });

  return job!.id;
}

export async function deleteProject(projectId: string): Promise<void> {
  const user = await requireUser();
  await getDb()
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.userId)));
  revalidatePath("/");
}

/* ── provider keys ──────────────────────────────────────────── */

export async function saveKey(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const provider = String(form.get("provider") ?? "") as ProviderId;
    const apiKey = String(form.get("apiKey") ?? "").trim();

    if (!PROVIDERS.includes(provider)) return { error: "Unknown provider." };
    if (!apiKey && provider !== "ollama") return { error: "Paste a key first." };

    // Verified before it is stored, so a bad key fails here rather than three
    // minutes into a run.
    try {
      await createProvider({ provider, apiKey }).verify();
    } catch {
      return { error: `${provider} rejected that key. Check it and try again.` };
    }

    const sealed = seal(apiKey, user.userId);

    await getDb()
      .insert(providerKeys)
      .values({
        userId: user.userId,
        provider,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        last4: last4(apiKey),
        mode: "stored",
        verifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [providerKeys.userId, providerKeys.provider],
        set: {
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          authTag: sealed.authTag,
          last4: last4(apiKey),
          mode: "stored",
          verifiedAt: new Date(),
        },
      });

    revalidatePath("/settings");
    return { ok: `${provider} key saved and verified.` };
  } catch (err) {
    return { error: toPublicError(err).message };
  }
}

export async function removeKey(provider: string): Promise<void> {
  const user = await requireUser();
  await getDb()
    .delete(providerKeys)
    .where(and(eq(providerKeys.userId, user.userId), eq(providerKeys.provider, provider)));
  revalidatePath("/settings");
}

/* ── resume & target role ───────────────────────────────────── */

export async function saveResume(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const db = getDb();

    const text = String(form.get("resume") ?? "").trim();
    const title = String(form.get("title") ?? "").trim();
    const company = String(form.get("company") ?? "").trim();
    const jd = String(form.get("jd") ?? "").trim();

    if (text) {
      await db.insert(resumes).values({ userId: user.userId, text, filename: "pasted" });
    }
    if (title) {
      await db.insert(targetRoles).values({
        userId: user.userId,
        title,
        company: company || null,
        jdText: jd || null,
      });
    }

    revalidatePath("/settings");
    return { ok: "Saved. New packs will be weighted toward this." };
  } catch (err) {
    return { error: toPublicError(err).message };
  }
}

/* ── spaced repetition ──────────────────────────────────────── */

export async function rateCard(cardId: string, rating: 1 | 2 | 3 | 4): Promise<void> {
  const user = await requireUser();
  const db = getDb();

  const card = await db.query.srsCards.findFirst({
    where: and(eq(srsCards.id, cardId), eq(srsCards.userId, user.userId)),
  });
  if (!card) return;

  const next = scheduleReview(
    {
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      lastReviewedAt: card.lastReviewedAt,
    },
    rating,
  );

  await db
    .update(srsCards)
    .set({
      stability: next.stability,
      difficulty: next.difficulty,
      reps: next.reps,
      lapses: next.lapses,
      dueAt: next.dueAt,
      lastReviewedAt: next.lastReviewedAt,
    })
    .where(eq(srsCards.id, cardId));

  await db.insert(reviews).values({ cardId, rating });
  revalidatePath("/review");
}

/** Turns a generated pack into a study deck. Idempotent. */
export async function addSetToDeck(setId: string): Promise<ActionState> {
  try {
    const user = await requireUser();
    const db = getDb();

    const rows = await db.query.questions.findMany({
      where: (q, { eq: equals }) => equals(q.setId, setId),
      columns: { id: true },
    });

    if (rows.length === 0) return { error: "Nothing to add yet." };

    await db
      .insert(srsCards)
      .values(rows.map((r) => ({ userId: user.userId, questionId: r.id })))
      .onConflictDoNothing();

    revalidatePath("/review");
    return { ok: `${rows.length} cards added to your deck.` };
  } catch (err) {
    return { error: toPublicError(err).message };
  }
}

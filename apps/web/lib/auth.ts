import { eq, getDb, users } from "@prepo/db";
import { config, PrepoError } from "@prepo/shared";
import { readSession, type SessionPayload } from "./session";

export const SINGLE_USER_EMAIL = "local@prepo.localhost";

/**
 * Single-user mode exists because the loudest complaint about self-hosted
 * software is being made to create an account on your own laptop. One env var,
 * no login screen, everything scoped to a default user that is created on
 * first request. It is a dozen lines and it wins over a real share of the
 * audience.
 */
async function singleUser(): Promise<SessionPayload> {
  const db = getDb();

  const existing = await db.query.users.findFirst({ where: eq(users.email, SINGLE_USER_EMAIL) });
  if (existing) {
    return { userId: existing.id, email: existing.email, name: existing.name ?? "You" };
  }

  const [created] = await db
    .insert(users)
    .values({ email: SINGLE_USER_EMAIL, name: "You" })
    .onConflictDoNothing()
    .returning();

  if (created) return { userId: created.id, email: created.email, name: "You" };

  // Lost a race with a concurrent first request.
  const raced = await db.query.users.findFirst({ where: eq(users.email, SINGLE_USER_EMAIL) });
  if (!raced) throw new PrepoError("internal", "Could not create the local user.");
  return { userId: raced.id, email: raced.email, name: "You" };
}

export async function currentUser(): Promise<SessionPayload | null> {
  if (config.singleUserMode) return singleUser();
  return readSession();
}

export async function requireUser(): Promise<SessionPayload> {
  const user = await currentUser();
  if (!user) throw new PrepoError("unauthorized", "Sign in to continue.");
  return user;
}

/** Providers this deployment can actually offer, for the sign-in page. */
export function enabledAuthProviders(): Array<"github" | "google" | "email"> {
  const configured = config.authProviders;
  const out: Array<"github" | "google" | "email"> = [];

  if (configured.includes("github") && process.env.GITHUB_CLIENT_ID) out.push("github");
  if (configured.includes("google") && process.env.GOOGLE_CLIENT_ID) out.push("google");
  if (configured.includes("email")) out.push("email");
  return out;
}

export function emailAllowed(email: string): boolean {
  const domains = config.allowedEmailDomains;
  if (domains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domains.some((d) => d.toLowerCase() === domain);
}

export async function upsertUser(input: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<SessionPayload> {
  const db = getDb();
  const email = input.email.toLowerCase();

  if (!emailAllowed(email)) {
    throw new PrepoError("unauthorized", "That email domain is not allowed on this deployment.");
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    return {
      userId: existing.id,
      email: existing.email,
      name: existing.name ?? undefined,
      avatarUrl: existing.avatarUrl ?? undefined,
    };
  }

  const [created] = await db
    .insert(users)
    .values({ email, name: input.name ?? null, avatarUrl: input.avatarUrl ?? null })
    .returning();

  return {
    userId: created!.id,
    email: created!.email,
    name: created!.name ?? undefined,
    avatarUrl: created!.avatarUrl ?? undefined,
  };
}

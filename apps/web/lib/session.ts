import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

const COOKIE = "prepo_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set. Generate one with `pnpm keygen`.");
  return new TextEncoder().encode(raw);
}

export interface SessionPayload {
  userId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

/**
 * Sessions are signed JWTs in an httpOnly cookie — no session table, no
 * lookup on every request.
 *
 * Written by hand rather than pulled from an auth library on purpose: it is
 * about ninety lines end to end including OAuth, a contributor can audit all
 * of it in one sitting, and it removes a dependency whose major versions move
 * faster than this project will.
 */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
    return {
      userId: payload.userId,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      avatarUrl: typeof payload.avatarUrl === "string" ? payload.avatarUrl : undefined,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

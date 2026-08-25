import { randomBytes, createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { eq, getDb, verificationTokens } from "@prepo/db";
import { config, PrepoError, toPublicError } from "@prepo/shared";
import { emailAllowed, enabledAuthProviders, upsertUser } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * OAuth2 authorisation-code flow for GitHub and Google, plus email magic
 * links. Written directly rather than through an auth library: this is the
 * whole of it, it is auditable in one read, and the CSRF `state` is a hashed
 * single-use token in the database rather than a cookie the callback trusts.
 */

interface OAuthProvider {
  authorizeUrl: string;
  tokenUrl: string;
  userUrl: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
  parseUser(profile: Record<string, unknown>, accessToken: string): Promise<{
    email: string;
    name?: string;
    avatarUrl?: string;
  }>;
}

const PROVIDERS: Record<string, OAuthProvider> = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scope: "read:user user:email",
    clientId: () => process.env.GITHUB_CLIENT_ID,
    clientSecret: () => process.env.GITHUB_CLIENT_SECRET,
    async parseUser(profile, accessToken) {
      let email = typeof profile.email === "string" ? profile.email : "";

      // GitHub hides private emails from /user; the dedicated endpoint has them.
      if (!email) {
        const response = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "prepo" },
        });
        if (response.ok) {
          const list = (await response.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
          email = list.find((e) => e.primary && e.verified)?.email ?? list[0]?.email ?? "";
        }
      }
      if (!email) throw new PrepoError("unauthorized", "GitHub did not return an email address.");

      return {
        email,
        name: typeof profile.name === "string" ? profile.name : (profile.login as string | undefined),
        avatarUrl: typeof profile.avatar_url === "string" ? profile.avatar_url : undefined,
      };
    },
  },

  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email profile",
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    async parseUser(profile) {
      const email = typeof profile.email === "string" ? profile.email : "";
      if (!email) throw new PrepoError("unauthorized", "Google did not return an email address.");
      return {
        email,
        name: typeof profile.name === "string" ? profile.name : undefined,
        avatarUrl: typeof profile.picture === "string" ? profile.picture : undefined,
      };
    },
  },
};

function callbackUrl(provider: string): string {
  return `${config.appUrl.replace(/\/+$/, "")}/api/auth/callback/${provider}`;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Single-use tokens, stored hashed, with a short TTL. */
async function issueToken(identifier: string, payload: Record<string, unknown>, ttlMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getDb()
    .insert(verificationTokens)
    .values({
      token: hash(token),
      identifier,
      payload,
      expiresAt: new Date(Date.now() + ttlMs),
    });
  return token;
}

async function consumeToken(token: string): Promise<{ identifier: string; payload: Record<string, unknown> } | null> {
  const db = getDb();
  const hashed = hash(token);

  const row = await db.query.verificationTokens.findFirst({
    where: eq(verificationTokens.token, hashed),
  });
  if (!row) return null;

  // Delete before validating expiry so a token can never be replayed.
  await db.delete(verificationTokens).where(eq(verificationTokens.token, hashed));
  if (row.expiresAt.getTime() < Date.now()) return null;

  return { identifier: row.identifier, payload: row.payload ?? {} };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ action: string[] }> },
): Promise<Response> {
  const { action } = await params;
  const [verb, provider] = action;

  try {
    if (config.singleUserMode) {
      return NextResponse.redirect(new URL("/", config.appUrl));
    }

    /* ── start ─────────────────────────────────────────────── */

    if (verb === "signin" && provider) {
      const spec = PROVIDERS[provider];
      if (!spec || !enabledAuthProviders().includes(provider as "github" | "google")) {
        throw new PrepoError("invalid_input", `${provider} sign-in is not enabled on this deployment.`);
      }

      const clientId = spec.clientId();
      if (!clientId) throw new PrepoError("invalid_input", `${provider} is missing its client id.`);

      const state = await issueToken(`oauth:${provider}`, { provider }, 10 * 60_000);
      const url = new URL(spec.authorizeUrl);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", callbackUrl(provider));
      url.searchParams.set("scope", spec.scope);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");

      return NextResponse.redirect(url);
    }

    /* ── callback ──────────────────────────────────────────── */

    if (verb === "callback" && provider) {
      const spec = PROVIDERS[provider];
      if (!spec) throw new PrepoError("invalid_input", "Unknown provider.");

      const code = request.nextUrl.searchParams.get("code");
      const state = request.nextUrl.searchParams.get("state");
      if (!code || !state) throw new PrepoError("unauthorized", "Sign-in was cancelled.");

      const consumed = await consumeToken(state);
      if (!consumed || consumed.payload.provider !== provider) {
        throw new PrepoError("unauthorized", "That sign-in link has expired. Try again.");
      }

      const tokenResponse = await fetch(spec.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: spec.clientId()!,
          client_secret: spec.clientSecret()!,
          code,
          redirect_uri: callbackUrl(provider),
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) throw new PrepoError("unauthorized", "The provider rejected the sign-in.");
      const tokens = (await tokenResponse.json()) as { access_token?: string };
      if (!tokens.access_token) throw new PrepoError("unauthorized", "No access token was returned.");

      const profileResponse = await fetch(spec.userUrl, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, "User-Agent": "prepo" },
      });
      if (!profileResponse.ok) throw new PrepoError("unauthorized", "Could not read your profile.");

      const profile = (await profileResponse.json()) as Record<string, unknown>;
      const session = await upsertUser(await spec.parseUser(profile, tokens.access_token));
      await createSession(session);

      return NextResponse.redirect(new URL("/", config.appUrl));
    }

    /* ── magic link ────────────────────────────────────────── */

    if (verb === "verify") {
      const token = request.nextUrl.searchParams.get("token");
      if (!token) throw new PrepoError("unauthorized", "Missing token.");

      const consumed = await consumeToken(token);
      if (!consumed) throw new PrepoError("unauthorized", "That link has expired. Request a new one.");

      await createSession(await upsertUser({ email: consumed.identifier }));
      return NextResponse.redirect(new URL("/", config.appUrl));
    }

    if (verb === "signout") {
      await destroySession();
      return NextResponse.redirect(new URL("/signin", config.appUrl));
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (err) {
    const publicError = toPublicError(err);
    const url = new URL("/signin", config.appUrl);
    url.searchParams.set("error", publicError.message);
    return NextResponse.redirect(url);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string[] }> },
): Promise<Response> {
  const { action } = await params;

  if (action[0] === "signout") {
    await destroySession();
    return NextResponse.redirect(new URL("/signin", config.appUrl), 303);
  }

  /* ── request a magic link ────────────────────────────────── */

  if (action[0] === "email") {
    const form = await request.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !emailAllowed(email)) {
      const url = new URL("/signin", config.appUrl);
      url.searchParams.set("error", "That email address is not valid for this deployment.");
      return NextResponse.redirect(url, 303);
    }

    const token = await issueToken(email, {}, 15 * 60_000);
    const link = `${config.appUrl.replace(/\/+$/, "")}/api/auth/verify?token=${token}`;

    if (process.env.SMTP_URL) {
      await sendMagicLink(email, link);
    } else {
      // No SMTP configured is the normal case in development. Printing the
      // link is more useful than failing, and the README says it happens.
      console.log(`\n[auth] magic link for ${email}:\n${link}\n`);
    }

    const url = new URL("/signin", config.appUrl);
    url.searchParams.set("sent", "1");
    return NextResponse.redirect(url, 303);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function sendMagicLink(email: string, link: string): Promise<void> {
  // Kept behind a dynamic import so nodemailer is optional: deployments that
  // never enable SMTP do not pay for the dependency.
  // @ts-ignore nodemailer is an optional runtime dependency
  const nodemailer = await import(/* webpackIgnore: true */ "nodemailer").catch(() => null);
  if (!nodemailer) {
    console.warn("[auth] SMTP_URL is set but nodemailer is not installed; printing link instead.");
    console.log(`[auth] magic link for ${email}: ${link}`);
    return;
  }

  const transport = nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({
    to: email,
    from: process.env.SMTP_FROM ?? "prepo@localhost",
    subject: "Your Prepo sign-in link",
    text: `Sign in to Prepo:\n\n${link}\n\nThis link expires in 15 minutes.`,
  });
}

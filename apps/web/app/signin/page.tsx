import { redirect } from "next/navigation";
import { config } from "@prepo/shared";
import { enabledAuthProviders } from "@/lib/auth";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  if (config.singleUserMode) redirect("/");
  if (await readSession()) redirect("/");

  const { error, sent } = await searchParams;
  const providers = enabledAuthProviders();

  return (
    <div style={{ maxWidth: "26rem", margin: "5rem auto 0" }}>
      <div className="eyebrow">Prepo</div>
      <h1 className="title" style={{ fontSize: "2rem", marginBottom: "1.5rem" }}>
        Sign in
      </h1>

      {error && <div className="notice warn" style={{ marginBottom: "1.25rem" }}>{error}</div>}
      {sent && (
        <div className="notice" style={{ marginBottom: "1.25rem" }}>
          Check your email for the sign-in link. It expires in 15 minutes.
        </div>
      )}

      <div className="stack">
        {providers.includes("github") && (
          <a className="btn" href="/api/auth/signin/github" style={{ justifyContent: "center" }}>
            Continue with GitHub
          </a>
        )}
        {providers.includes("google") && (
          <a className="btn ghost" href="/api/auth/signin/google" style={{ justifyContent: "center" }}>
            Continue with Google
          </a>
        )}

        {providers.includes("email") && (
          <form action="/api/auth/email" method="post" className="card card-pad">
            <label className="field">
              <span>Email a sign-in link</span>
              <input type="email" name="email" required placeholder="you@example.com" autoComplete="email" />
            </label>
            <button type="submit" style={{ width: "100%", justifyContent: "center" }}>
              Send link
            </button>
          </form>
        )}

        {providers.length === 0 && (
          <div className="notice warn">
            <span className="label">No sign-in method is configured</span>
            <p style={{ margin: 0 }}>
              Set <code>AUTH_PROVIDERS</code> and the matching client credentials, or run with{" "}
              <code>SINGLE_USER_MODE=true</code> for a personal install with no login at all.
            </p>
          </div>
        )}
      </div>

      <p className="small muted" style={{ marginTop: "2rem" }}>
        Self-hosted. Your code goes exactly two places: this machine&apos;s Postgres, and the model provider whose key
        you supplied.
      </p>
    </div>
  );
}

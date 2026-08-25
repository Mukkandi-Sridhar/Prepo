import { redirect } from "next/navigation";
import { getDb } from "@prepo/db";
import { availableProviders } from "@prepo/engine";
import { allTiers, defaultProvider, PRICING_FETCHED_AT, PROVIDER_LABELS, PROVIDERS } from "@prepo/llm";
import { createEmbedder } from "@prepo/llm";
import { config } from "@prepo/shared";
import { currentUser } from "@/lib/auth";
import { KeyForm, ResumeForm } from "@/components/settings-forms";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const db = getDb();
  const configured = await availableProviders(db, user.userId);
  const active = defaultProvider();
  const tiers = allTiers(active);
  const embedder = createEmbedder();

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Settings</div>
        <h1 className="title">Keys and tailoring</h1>
        <p className="lede">
          Your key is encrypted with AES-256-GCM before it touches the database, never written to a log, and only ever
          used for your own runs.
        </p>
      </div>

      <div className="stack" style={{ gap: "2rem" }}>
        <section className="card">
          <div className="card-head">
            <span className="label">Model providers</span>
            <span className="small muted" style={{ marginLeft: "auto" }}>
              active: {PROVIDER_LABELS[active]}
            </span>
          </div>

          <div className="card-pad">
            <div className="tbl-wrap" style={{ marginBottom: "1.35rem" }}>
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>Key</th>
                  </tr>
                </thead>
                <tbody>
                  {PROVIDERS.map((provider) => {
                    const row = configured.find((c) => c.provider === provider);
                    return (
                      <tr key={provider}>
                        <td>{PROVIDER_LABELS[provider]}</td>
                        <td>
                          {row ? (
                            <span className="chip accent">
                              {row.source === "env" ? "from environment" : "saved"}
                            </span>
                          ) : (
                            <span className="chip">not configured</span>
                          )}
                        </td>
                        <td className="mono muted">
                          {row ? (row.source === "env" ? "set in .env" : `••••${row.last4}`) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <KeyForm />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="label">Model routing</span>
          </div>
          <div className="card-pad">
            <p className="small muted">
              Stages ask for a capability tier, not a model name, so adopting a newly released model is one edit to{" "}
              <code>packages/llm/src/models.json</code>. Cost estimates use rates fetched {PRICING_FETCHED_AT}.
            </p>

            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Used for</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="chip">fast</span></td>
                    <td>Per-file summaries — hundreds of calls, cost dominates</td>
                    <td className="mono">{tiers.fast.id}</td>
                  </tr>
                  <tr>
                    <td><span className="chip">balanced</span></td>
                    <td>Question generation, verification, interview turns</td>
                    <td className="mono">{tiers.balanced.id}</td>
                  </tr>
                  <tr>
                    <td><span className="chip accent">frontier</span></td>
                    <td>The dossier — one call whose quality compounds everywhere</td>
                    <td className="mono">{tiers.frontier.id}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="small muted" style={{ marginTop: "1rem", marginBottom: 0 }}>
              Embeddings: <code>{embedder.id}</code>
              {embedder.id === "local-hash" && (
                <>
                  {" "}— the dependency-free local embedder. It matches vocabulary rather than meaning, so retrieval is
                  noticeably weaker. Set <code>OPENAI_API_KEY</code> or run Ollama for better results.
                </>
              )}
            </p>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="label">Resume &amp; target role</span>
            <span className="small muted" style={{ marginLeft: "auto" }}>optional</span>
          </div>
          <div className="card-pad">
            <p className="small muted">
              Questions get weighted toward the claims you actually made and the stack the role wants. Prepo will also
              tell you which claims your code doesn&apos;t support — which is uncomfortable, and much better learned here.
            </p>
            <ResumeForm />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <span className="label">This deployment</span>
          </div>
          <div className="card-pad">
            <dl className="stats">
              <div className="stat">
                <dt>Mode</dt>
                <dd>{config.singleUserMode ? "Single user" : "Multi user"}</dd>
              </div>
              <div className="stat">
                <dt>Budget / run</dt>
                <dd>${(config.limits.budgetCentsPerRun / 100).toFixed(2)}</dd>
              </div>
              <div className="stat">
                <dt>Max repo</dt>
                <dd>{Math.round(config.limits.maxRepoBytes / 1024 / 1024)}<span className="unit">MB</span></dd>
              </div>
              <div className="stat">
                <dt>Telemetry</dt>
                <dd>{config.telemetry ? "On" : "Off"}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </>
  );
}

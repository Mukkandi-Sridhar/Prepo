"use client";

import { useActionState, useState } from "react";
import { PROVIDER_LABELS, PROVIDERS, type ProviderId } from "@prepo/llm";
import { saveKey, saveResume, type ActionState } from "@/app/actions";

const PLACEHOLDER: Record<ProviderId, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  google: "AIza…",
  openrouter: "sk-or-…",
  ollama: "no key needed — leave blank",
};

export function KeyForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveKey, {});
  const [provider, setProvider] = useState<ProviderId>("anthropic");

  return (
    <form action={action}>
      <div className="grid two">
        <label className="field">
          <span>Provider</span>
          <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>API key</span>
          <input
            type="password"
            name="apiKey"
            placeholder={PLACEHOLDER[provider]}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="hint" style={{ marginBottom: "1rem" }}>
        The key is verified with one tiny request before it is stored, so a bad key fails here rather than three
        minutes into a run.
      </div>

      {state.error && <div className="notice warn" style={{ marginBottom: "1rem" }}>{state.error}</div>}
      {state.ok && <div className="notice" style={{ marginBottom: "1rem" }}>{state.ok}</div>}

      <button type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Save key"}
      </button>
    </form>
  );
}

export function ResumeForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveResume, {});

  return (
    <form action={action}>
      <label className="field">
        <span>Resume text</span>
        <textarea
          name="resume"
          rows={7}
          placeholder="Paste the bullet points for this project — the claims an interviewer would ask you to back up."
        />
      </label>

      <div className="grid two">
        <label className="field">
          <span>Target role</span>
          <input type="text" name="title" placeholder="Backend Engineer" />
        </label>
        <label className="field">
          <span>Company</span>
          <input type="text" name="company" placeholder="optional" />
        </label>
      </div>

      <label className="field">
        <span>Job description</span>
        <textarea name="jd" rows={5} placeholder="Paste it and questions get weighted toward what this role cares about." />
      </label>

      {state.error && <div className="notice warn" style={{ marginBottom: "1rem" }}>{state.error}</div>}
      {state.ok && <div className="notice" style={{ marginBottom: "1rem" }}>{state.ok}</div>}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

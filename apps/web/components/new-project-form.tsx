"use client";

import { useActionState, useState } from "react";
import { createProject, type ActionState } from "@/app/actions";

export function NewProjectForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProject, {});
  const [mode, setMode] = useState<"git" | "zip">("git");

  return (
    <form action={action} className="card">
      <div className="card-head">
        <span className="label">Add a project</span>
        <div className="row" style={{ marginLeft: "auto", gap: ".3rem" }}>
          <button
            type="button"
            className={mode === "git" ? "small" : "ghost small"}
            onClick={() => setMode("git")}
            aria-pressed={mode === "git"}
          >
            Repository URL
          </button>
          <button
            type="button"
            className={mode === "zip" ? "small" : "ghost small"}
            onClick={() => setMode("zip")}
            aria-pressed={mode === "zip"}
          >
            Upload .zip
          </button>
        </div>
      </div>

      <div className="card-pad">
        {mode === "git" ? (
          <label className="field">
            <span>Public repository URL</span>
            <input
              type="url"
              name="url"
              placeholder="https://github.com/you/your-project"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="hint">
              GitHub, GitLab, Bitbucket, Codeberg or sr.ht. Nothing is executed — the code is only ever parsed.
            </div>
          </label>
        ) : (
          <label className="field">
            <span>Project archive</span>
            <input type="file" name="zip" accept=".zip,application/zip" />
            <div className="hint">
              Private code stays on this machine. Symlinks and traversal paths are rejected before extraction.
            </div>
          </label>
        )}

        {state.error && (
          <div className="notice warn" style={{ marginBottom: "1rem" }}>
            {state.error}
          </div>
        )}

        <button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Analyse this project"}
        </button>
      </div>
    </form>
  );
}

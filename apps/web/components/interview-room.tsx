"use client";

import { useEffect, useRef, useState } from "react";
import { MODE_CONFIG, RUBRIC_LABELS, type Evaluation, type InterviewMode } from "@prepo/shared";

interface Turn {
  role: "interviewer" | "candidate";
  content: string;
}

type Phase = "idle" | "live" | "scoring" | "done";

export function InterviewRoom({ projectId }: { projectId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<InterviewMode>("standard");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript, evaluation]);

  async function start() {
    setError(null);
    setThinking(true);
    try {
      const response = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start the interview.");

      setSessionId(data.sessionId);
      setTranscript([{ role: "interviewer", content: data.opening }]);
      setRemaining(MODE_CONFIG[mode].turns);
      setPhase("live");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setThinking(false);
    }
  }

  async function send() {
    const text = answer.trim();
    if (!text || !sessionId || thinking) return;

    setAnswer("");
    setTranscript((prev) => [...prev, { role: "candidate", content: text }]);
    setThinking(true);
    setError(null);

    try {
      const response = await fetch(`/api/interview/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The interviewer lost their train of thought.");

      setTranscript((prev) => [...prev, { role: "interviewer", content: data.say }]);
      setRemaining(data.turnsRemaining);
      if (data.wrapped) void finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setThinking(false);
    }
  }

  async function finish() {
    if (!sessionId) return;
    setPhase("scoring");
    setThinking(true);
    try {
      const response = await fetch(`/api/interview/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not score the interview.");
      setEvaluation(data.evaluation);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("live");
    } finally {
      setThinking(false);
    }
  }

  /* ── setup ─────────────────────────────────────────────── */

  if (phase === "idle") {
    return (
      <section className="card">
        <div className="card-head">
          <span className="label">Choose a format</span>
        </div>
        <div className="card-pad">
          <div className="grid three" style={{ marginBottom: "1.25rem" }}>
            {(Object.keys(MODE_CONFIG) as InterviewMode[]).map((m) => (
              <button
                key={m}
                className={mode === m ? "" : "ghost"}
                onClick={() => setMode(m)}
                style={{ flexDirection: "column", alignItems: "flex-start", padding: ".8rem 1rem" }}
              >
                <span style={{ fontSize: "1rem" }}>{MODE_CONFIG[m].label}</span>
                <span style={{ fontSize: ".74rem", fontWeight: 400, opacity: 0.8 }}>{MODE_CONFIG[m].blurb}</span>
              </button>
            ))}
          </div>

          {error && <div className="notice warn" style={{ marginBottom: "1rem" }}>{error}</div>}

          <button onClick={start} disabled={thinking}>
            {thinking ? "Reading your code…" : "Begin"}
          </button>
        </div>
      </section>
    );
  }

  /* ── live + results ────────────────────────────────────── */

  return (
    <>
      <section className="card">
        <div className="card-head">
          <span className="label">Transcript</span>
          {remaining !== null && phase === "live" && (
            <span className="mono muted" style={{ marginLeft: "auto" }}>
              ~{remaining} exchange{remaining === 1 ? "" : "s"} left
            </span>
          )}
        </div>

        <div className="card-pad">
          {transcript.map((turn, i) => (
            <div key={i} className={`turn ${turn.role}`}>
              <div className="who">{turn.role === "interviewer" ? "Interviewer" : "You"}</div>
              <p>{turn.content}</p>
            </div>
          ))}

          {thinking && phase === "live" && (
            <div className="turn interviewer">
              <div className="who">Interviewer</div>
              <p className="muted">thinking…</p>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </section>

      {error && <div className="notice warn" style={{ marginTop: "1rem" }}>{error}</div>}

      {phase === "live" && (
        <section style={{ marginTop: "1.25rem" }}>
          <textarea
            ref={inputRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
            }}
            placeholder="Answer out loud, then type the short version…"
            rows={4}
            disabled={thinking}
          />
          <div className="row" style={{ marginTop: ".7rem", justifyContent: "space-between" }}>
            <button onClick={send} disabled={thinking || answer.trim().length === 0}>
              Answer
            </button>
            <div className="row" style={{ gap: ".6rem" }}>
              <span className="small muted">⌘↵ to send</span>
              <button className="ghost small" onClick={finish} disabled={thinking}>
                End &amp; score
              </button>
            </div>
          </div>
        </section>
      )}

      {phase === "scoring" && (
        <div className="notice" style={{ marginTop: "1.25rem" }}>
          Scoring the transcript against the rubric…
        </div>
      )}

      {evaluation && <Scorecard evaluation={evaluation} />}
    </>
  );
}

function Scorecard({ evaluation }: { evaluation: Evaluation }) {
  const tone = (score: number) => (score >= 3.5 ? "" : score >= 2.5 ? "warn" : "bad");

  return (
    <section className="card" style={{ marginTop: "1.5rem" }}>
      <div className="card-head">
        <span className="label">Scorecard</span>
        <span className="mono" style={{ marginLeft: "auto", color: "var(--accent)" }}>
          {evaluation.overall.toFixed(1)} / 5
        </span>
      </div>

      <div className="card-pad">
        <p style={{ fontFamily: "var(--f-display)", fontSize: "1.15rem", fontWeight: 600, marginBottom: "1.25rem" }}>
          {evaluation.headline}
        </p>

        <div className="stack" style={{ gap: "1rem" }}>
          {evaluation.scores.map((s) => (
            <div key={s.dimension}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: ".3rem" }}>
                <strong style={{ fontFamily: "var(--f-display)", fontSize: ".95rem" }}>
                  {RUBRIC_LABELS[s.dimension]}
                </strong>
                <span className="mono">{s.score.toFixed(1)}</span>
              </div>
              <div className={`meter ${tone(s.score)}`}>
                <i style={{ width: `${(s.score / 5) * 100}%` }} />
              </div>
              <p className="small muted" style={{ margin: ".4rem 0 0" }}>{s.evidence}</p>
              <p className="small" style={{ margin: ".2rem 0 0" }}>→ {s.improve}</p>
            </div>
          ))}
        </div>

        {evaluation.nextSteps.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <div className="label">Next steps</div>
            <div className="probes" style={{ marginTop: ".4rem" }}>
              {evaluation.nextSteps.map((step, i) => (
                <div key={i}>{i + 1}. {step}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import { CATEGORY_LABELS, DIFFICULTY_LABELS, type QuestionCategory } from "@prepo/shared";

export interface QuestionView {
  id: string;
  category: string;
  difficulty: string;
  persona: string;
  stem: string;
  modelAnswer: string;
  probes: string[];
  testingFor: string;
  redFlags: string[];
  groundedness: number;
  citations: Array<{ path: string; startLine: number; endLine: number }>;
}

const INITIAL_VISIBLE = 40;

export function QuestionList({ questions }: { questions: QuestionView[] }) {
  const [category, setCategory] = useState<string>("all");
  const [difficulty, setDifficulty] = useState<string>("all");
  const [showAll, setShowAll] = useState(false);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [questions]);

  const filtered = useMemo(
    () =>
      questions.filter(
        (q) => (category === "all" || q.category === category) && (difficulty === "all" || q.difficulty === difficulty),
      ),
    [questions, category, difficulty],
  );

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_VISIBLE);

  return (
    <>
      <div className="row" style={{ marginBottom: "1rem", gap: ".35rem" }}>
        <button className={category === "all" ? "small" : "ghost small"} onClick={() => setCategory("all")}>
          All {questions.length}
        </button>
        {categories.map(([id, count]) => (
          <button
            key={id}
            className={category === id ? "small" : "ghost small"}
            onClick={() => setCategory(id)}
          >
            {CATEGORY_LABELS[id as QuestionCategory] ?? id} {count}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: "1.25rem", gap: ".35rem" }}>
        <span className="label" style={{ marginRight: ".2rem" }}>Level</span>
        {["all", "L1", "L2", "L3"].map((level) => (
          <button
            key={level}
            className={difficulty === level ? "small" : "ghost small"}
            onClick={() => setDifficulty(level)}
          >
            {level === "all" ? "Any" : DIFFICULTY_LABELS[level as "L1" | "L2" | "L3"]}
          </button>
        ))}
      </div>

      <div className="stack">
        {visible.map((q) => (
          <details key={q.id} className="qcard">
            <summary>
              <div className="row">
                <span className="chip accent">{CATEGORY_LABELS[q.category as QuestionCategory] ?? q.category}</span>
                <span className="chip">{DIFFICULTY_LABELS[q.difficulty as "L1" | "L2" | "L3"] ?? q.difficulty}</span>
                <span className="chip">{q.persona.replace("-", " ")}</span>
                <span className="mono muted" style={{ marginLeft: "auto" }}>
                  grounded {q.groundedness.toFixed(2)}
                </span>
              </div>
              <div className="qstem">{q.stem}</div>
            </summary>

            <div className="qbody">
              <div className="qsection">
                <div className="label">What they&apos;re testing</div>
                <p className="small">{q.testingFor}</p>
              </div>

              <div className="qsection">
                <div className="label">Your answer</div>
                <p className="answer">{q.modelAnswer}</p>
              </div>

              {q.probes.length > 0 && (
                <div className="qsection">
                  <div className="label">They&apos;ll follow up with</div>
                  <div className="probes">
                    {q.probes.map((p, i) => (
                      <div key={i}>→ {p}</div>
                    ))}
                  </div>
                </div>
              )}

              {q.redFlags.length > 0 && (
                <div className="qsection">
                  <div className="label" style={{ color: "var(--signal)" }}>Avoid</div>
                  <div className="probes">
                    {q.redFlags.map((r, i) => (
                      <div key={i}>× {r}</div>
                    ))}
                  </div>
                </div>
              )}

              {q.citations.length > 0 && (
                <div className="qsection">
                  <div className="label">Evidence</div>
                  <div className="row" style={{ gap: ".3rem" }}>
                    {q.citations.map((c, i) => (
                      <span key={i} className="cite">
                        {c.path}:{c.startLine}–{c.endLine}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>

      {!showAll && filtered.length > INITIAL_VISIBLE && (
        <button className="ghost" style={{ marginTop: "1.25rem" }} onClick={() => setShowAll(true)}>
          Show the remaining {filtered.length - INITIAL_VISIBLE}
        </button>
      )}
    </>
  );
}

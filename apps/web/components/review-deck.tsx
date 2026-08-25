"use client";

import { useState, useTransition } from "react";
import { rateCard } from "@/app/actions";

export interface ReviewCard {
  cardId: string;
  stem: string;
  answer: string;
  category: string;
  probes: string[];
  citations: string[];
  reps: number;
}

const RATINGS: Array<{ value: 1 | 2 | 3 | 4; label: string; hint: string }> = [
  { value: 1, label: "Again", hint: "couldn't answer" },
  { value: 2, label: "Hard", hint: "got there slowly" },
  { value: 3, label: "Good", hint: "answered it" },
  { value: 4, label: "Easy", hint: "instant" },
];

export function ReviewDeck({ cards, totalInDeck }: { cards: ReviewCard[]; totalInDeck: number }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();

  const card = cards[index];

  if (!card) {
    return (
      <div className="empty">
        <h3>Done for now</h3>
        <p>You cleared every card that was due. {totalInDeck} in the deck overall.</p>
      </div>
    );
  }

  function rate(rating: 1 | 2 | 3 | 4) {
    const current = card!;
    startTransition(async () => {
      await rateCard(current.cardId, rating);
      setRevealed(false);
      setIndex((i) => i + 1);
    });
  }

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <span className="chip accent">{card.category}</span>
        <span className="mono muted">
          {index + 1} / {cards.length} due · {totalInDeck} in deck
        </span>
      </div>

      <section className="card">
        <div className="card-pad">
          <p style={{ fontFamily: "var(--f-display)", fontSize: "1.2rem", fontWeight: 600, lineHeight: 1.35 }}>
            {card.stem}
          </p>

          {!revealed ? (
            <>
              <p className="small muted" style={{ marginTop: "1.5rem" }}>
                Answer it out loud first. Reading the answer before trying is the fastest way to feel prepared and not
                be.
              </p>
              <button onClick={() => setRevealed(true)} style={{ marginTop: ".5rem" }}>
                Show the answer
              </button>
            </>
          ) : (
            <>
              <hr style={{ border: 0, borderTop: "1px solid var(--rule)", margin: "1.25rem 0" }} />
              <p className="answer">{card.answer}</p>

              {card.probes.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <div className="label">Follow-ups</div>
                  <div className="probes" style={{ marginTop: ".35rem" }}>
                    {card.probes.map((p, i) => (
                      <div key={i}>→ {p}</div>
                    ))}
                  </div>
                </div>
              )}

              {card.citations.length > 0 && (
                <div className="row" style={{ gap: ".3rem", marginTop: "1rem" }}>
                  {card.citations.map((c, i) => (
                    <span key={i} className="cite">{c}</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {revealed && (
        <div className="row" style={{ marginTop: "1.25rem", gap: ".5rem" }}>
          {RATINGS.map((r) => (
            <button
              key={r.value}
              className={r.value >= 3 ? "" : "ghost"}
              disabled={pending}
              onClick={() => rate(r.value)}
              style={{ flexDirection: "column", alignItems: "flex-start" }}
            >
              <span>{r.label}</span>
              <span style={{ fontSize: ".7rem", fontWeight: 400, opacity: 0.75 }}>{r.hint}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

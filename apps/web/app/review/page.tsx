import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, citations, count, eq, getDb, inArray, lte, questions, srsCards } from "@prepo/db";
import { CATEGORY_LABELS, type QuestionCategory } from "@prepo/shared";
import { currentUser } from "@/lib/auth";
import { ReviewDeck, type ReviewCard } from "@/components/review-deck";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const db = getDb();

  // One join for the due cards, one query for their citations. No N+1 — this
  // page is opened daily by anyone actually using the deck.
  const due = await db
    .select({
      cardId: srsCards.id,
      reps: srsCards.reps,
      questionId: questions.id,
      stem: questions.stem,
      answer: questions.modelAnswer,
      category: questions.category,
      probes: questions.probes,
    })
    .from(srsCards)
    .innerJoin(questions, eq(questions.id, srsCards.questionId))
    .where(and(eq(srsCards.userId, user.userId), lte(srsCards.dueAt, new Date())))
    .orderBy(asc(srsCards.dueAt))
    .limit(40);

  const [total] = await db
    .select({ value: count() })
    .from(srsCards)
    .where(eq(srsCards.userId, user.userId));

  const citationsByQuestion = new Map<string, string[]>();
  if (due.length > 0) {
    const rows = await db
      .select()
      .from(citations)
      .where(inArray(citations.questionId, due.map((d) => d.questionId)));

    for (const row of rows) {
      const list = citationsByQuestion.get(row.questionId) ?? [];
      list.push(`${row.path}:${row.startLine}–${row.endLine}`);
      citationsByQuestion.set(row.questionId, list);
    }
  }

  const cards: ReviewCard[] = due.map((row) => ({
    cardId: row.cardId,
    stem: row.stem,
    answer: row.answer,
    category: CATEGORY_LABELS[row.category as QuestionCategory] ?? row.category,
    probes: row.probes ?? [],
    citations: citationsByQuestion.get(row.questionId) ?? [],
    reps: row.reps,
  }));

  return (
    <>
      <div className="page-head">
        <div className="eyebrow">Spaced repetition</div>
        <h1 className="title">Review</h1>
        <p className="lede">
          Cards you nearly forgot teach you more than cards you know cold — the scheduler leans into that, so intervals
          stretch fastest on the answers you had to reach for.
        </p>
      </div>

      {!total || total.value === 0 ? (
        <div className="empty">
          <h3>Your deck is empty</h3>
          <p>
            Open a project and choose <strong>Add to deck</strong> to turn its pack into flashcards.{" "}
            <Link href="/">Go to projects</Link>
          </p>
        </div>
      ) : cards.length === 0 ? (
        <div className="empty">
          <h3>Nothing due right now</h3>
          <p>
            {total.value} card{total.value === 1 ? "" : "s"} scheduled. Come back when the next one is due — or add
            another project&apos;s pack.
          </p>
        </div>
      ) : (
        <ReviewDeck cards={cards} totalInDeck={total.value} />
      )}
    </>
  );
}

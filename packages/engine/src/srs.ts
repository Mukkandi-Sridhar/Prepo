/**
 * FSRS-style spaced repetition, reduced to the parts that matter here.
 *
 * The full FSRS-5 model fits 17 optimisable parameters against a user's review
 * history. With a few dozen cards per project there is nothing to fit, so this
 * keeps the model's shape — stability, difficulty, retrievability — and uses
 * published default weights. It schedules well and it is 60 lines instead of a
 * dependency.
 */

export type Rating = 1 | 2 | 3 | 4; // again · hard · good · easy

export interface CardState {
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewedAt: Date | null;
}

export interface Scheduled extends CardState {
  dueAt: Date;
  intervalDays: number;
}

const DESIRED_RETENTION = 0.9;
const DECAY = -0.5;
const FACTOR = 19 / 81;

const W = {
  initialStability: [0.4, 1.2, 3.2, 15.7],
  initialDifficulty: 5.4,
  difficultyDelta: 0.9,
  stabilityGain: 1.6,
  lapsePenalty: 0.35,
  hardPenalty: 0.8,
  easyBonus: 1.3,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function newCard(): CardState {
  return { stability: 0, difficulty: W.initialDifficulty, reps: 0, lapses: 0, lastReviewedAt: null };
}

/** Probability the answer is still recalled, given elapsed time. */
export function retrievability(stability: number, elapsedDays: number): number {
  if (stability <= 0) return 0;
  return (1 + (FACTOR * elapsedDays) / stability) ** DECAY;
}

export function review(state: CardState, rating: Rating, now = new Date()): Scheduled {
  const elapsedDays = state.lastReviewedAt
    ? Math.max(0, (now.getTime() - state.lastReviewedAt.getTime()) / 86_400_000)
    : 0;

  const difficulty = clamp(
    state.difficulty + W.difficultyDelta * (3 - rating),
    1,
    10,
  );

  let stability: number;

  if (state.reps === 0) {
    stability = W.initialStability[rating - 1]!;
  } else if (rating === 1) {
    // A lapse does not reset to zero — the card is still easier than it was
    // the first time it was seen.
    stability = Math.max(0.4, state.stability * W.lapsePenalty);
  } else {
    const r = retrievability(state.stability, elapsedDays);
    const easeMultiplier = rating === 2 ? W.hardPenalty : rating === 4 ? W.easyBonus : 1;
    // Reviewing a card you had almost forgotten teaches more than reviewing
    // one you knew cold; (1 - r) is what encodes that.
    const gain = 1 + W.stabilityGain * (1 - r) * ((11 - difficulty) / 10) * easeMultiplier;
    stability = state.stability * gain;
  }

  stability = clamp(stability, 0.1, 365 * 5);

  const intervalDays = clamp(
    (stability / FACTOR) * (DESIRED_RETENTION ** (1 / DECAY) - 1),
    rating === 1 ? 0.007 : 1, // a lapsed card comes back in ~10 minutes
    365 * 2,
  );

  return {
    stability,
    difficulty,
    reps: state.reps + 1,
    lapses: state.lapses + (rating === 1 ? 1 : 0),
    lastReviewedAt: now,
    dueAt: new Date(now.getTime() + intervalDays * 86_400_000),
    intervalDays,
  };
}

export function formatInterval(days: number): string {
  if (days < 1 / 24) return `${Math.round(days * 24 * 60)}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

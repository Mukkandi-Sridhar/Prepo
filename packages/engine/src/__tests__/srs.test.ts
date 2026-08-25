import { describe, expect, it } from "vitest";
import { formatInterval, newCard, retrievability, review } from "../srs.js";

describe("FSRS Spaced Repetition (srs.ts)", () => {
  it("initializes a new card with default state", () => {
    const card = newCard();
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.stability).toBe(0);
  });

  it("calculates retrievability decay over time", () => {
    const r0 = retrievability(10, 0); // 0 days elapsed
    const r10 = retrievability(10, 10); // 10 days elapsed
    const r30 = retrievability(10, 30); // 30 days elapsed

    expect(r0).toBe(1.0);
    expect(r10).toBeLessThan(r0);
    expect(r30).toBeLessThan(r10);
  });

  it("updates card stability and schedules next review on rating", () => {
    const card = newCard();
    const now = new Date("2026-01-01T00:00:00Z");

    const review1 = review(card, 3, now); // Good rating
    expect(review1.reps).toBe(1);
    expect(review1.stability).toBeGreaterThan(0);
    expect(review1.dueAt.getTime()).toBeGreaterThan(now.getTime());

    // Review again 5 days later with "Good" rating
    const review2Time = new Date("2026-01-06T00:00:00Z");
    const review2 = review(review1, 3, review2Time);
    expect(review2.reps).toBe(2);
    expect(review2.stability).toBeGreaterThan(review1.stability);
  });

  it("handles lapses correctly on rating 1 (Again)", () => {
    const card = newCard();
    const review1 = review(card, 3);
    const lapsed = review(review1, 1); // Lapse

    expect(lapsed.lapses).toBe(1);
    expect(lapsed.stability).toBeLessThan(review1.stability);
  });

  it("formats review intervals into human readable strings", () => {
    expect(formatInterval(0.01)).toContain("m");
    expect(formatInterval(0.5)).toContain("h");
    expect(formatInterval(5)).toBe("5d");
    expect(formatInterval(60)).toBe("2mo");
    expect(formatInterval(400)).toBe("1.1y");
  });
});

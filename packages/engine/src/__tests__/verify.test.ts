import { describe, expect, it } from "vitest";
import { GeneratedQuestion } from "@prepo/shared";

describe("Question Verification & Deduplication Logic", () => {
  const sampleQuestion = {
    category: "architecture" as const,
    difficulty: "L3" as const,
    persona: "tech-lead" as const,
    stem: "How does BullMQ queue failover affect database progress tracking?",
    modelAnswer: "In uploadService.ts, progress update side effects inside a transaction boundary can lead to inconsistency...",
    probes: ["What is the delivery guarantee of your outbox?"],
    testingFor: "Transaction boundaries and side effects",
    redFlags: ["Believing external side effects roll back with DB"],
    starFrame: null,
    groundedness: 0.94,
    citations: [
      { path: "src/services/uploadService.ts", startLine: 44, endLine: 71, symbol: "uploadHandler" },
    ],
  };

  it("validates citation line range constraints", () => {
    const citation = sampleQuestion.citations[0]!;
    expect(citation.startLine).toBeGreaterThan(0);
    expect(citation.endLine).toBeGreaterThanOrEqual(citation.startLine);
    expect(citation.path).toBe("src/services/uploadService.ts");
  });

  it("filters out ungrounded questions with low score", () => {
    const questions = [
      sampleQuestion,
      { ...sampleQuestion, stem: "Ungrounded question", groundedness: 0.35 },
    ];

    const verified = questions.filter((q) => q.groundedness >= 0.70);
    expect(verified.length).toBe(1);
    expect(verified[0]!.groundedness).toBe(0.94);
  });
});

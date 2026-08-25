import { describe, expect, it } from "vitest";
import { HeuristicChunker } from "../chunker.js";

describe("HeuristicChunker", () => {
  const chunker = new HeuristicChunker();

  it("chunks TypeScript file on declaration boundaries", () => {
    const code = `
import fs from "node:fs";
import path from "node:path";
import { config, PrepoError } from "@prepo/shared";

/**
 * Main data processing pipeline handler.
 * Performs validation, formatting, and transformation of incoming requests.
 */
export function processData(input: string): string {
  if (!input || input.length === 0) {
    throw new PrepoError("invalid_input", "Input data string cannot be empty.");
  }
  const sanitized = input.trim().toLowerCase();
  return sanitized.replace(/[^a-z0-9_-]/g, "_");
}

export class PipelineExecutionEngine {
  readonly version = "1.0.0";
  run(payload: Record<string, unknown>): boolean {
    console.log("Executing pipeline with payload keys:", Object.keys(payload));
    return true;
  }
}
`;

    const chunks = chunker.chunk("src/service.ts", "TypeScript", code);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.path).toBe("src/service.ts");
    expect(chunks.some((c) => c.symbol?.includes("processData"))).toBe(true);
    expect(chunks.some((c) => c.symbol?.includes("PipelineExecutionEngine"))).toBe(true);
  });

  it("chunks Python file on function and class definitions", () => {
    const pyCode = `
import os
import sys
import logging

def calculate_metric(data: list) -> float:
    """Calculates average metric value over a dataset slice."""
    if not data:
        return 0.0
    total_sum = sum(data)
    total_count = len(data)
    logging.info(f"Processing {total_count} data points with total sum {total_sum}")
    return float(total_sum) / float(total_count)

class MetricEvaluator:
    def __init__(self, threshold: float = 0.85):
        self.threshold = threshold
        self.results = []

    def evaluate(self, score: float) -> bool:
        passed = score >= self.threshold
        self.results.append((score, passed))
        return passed
`;

    const chunks = chunker.chunk("lib/eval.py", "Python", pyCode);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.symbol?.includes("calculate_metric"))).toBe(true);
  });

  it("handles blank lines for unknown languages gracefully", () => {
    const text = "Line 1 detail contents for testing long string chunking\n".repeat(10) + "\n" + "Line 2 detail contents for testing long string chunking\n".repeat(10);
    const chunks = chunker.chunk("data.txt", "Text", text);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

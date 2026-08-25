export interface MetricResult {
  metric: string;
  score: number;
  threshold: number;
  passed: boolean;
  unit?: string;
  details?: string;
}

export interface EvalReport {
  timestamp: string;
  fixturesEvaluated: number;
  metrics: MetricResult[];
  overallPassed: boolean;
}

export interface EvaluatedCitation {
  path: string;
  startLine: number;
  endLine: number;
  symbol?: string | null;
}

export interface EvaluatedQuestion {
  category: string;
  stem: string;
  groundedness: number;
  citations: EvaluatedCitation[];
}

/** 1. Citation Validity Gate: 100% of citations must resolve to real file line ranges. */
export function scoreCitationValidity(
  questions: EvaluatedQuestion[],
  fileLinesMap: Map<string, number>,
): MetricResult {
  let totalCitations = 0;
  let validCitations = 0;

  for (const q of questions) {
    for (const c of q.citations) {
      totalCitations++;
      const maxLines = fileLinesMap.get(c.path);
      if (
        maxLines !== undefined &&
        c.startLine >= 1 &&
        c.endLine >= c.startLine &&
        c.startLine <= maxLines
      ) {
        validCitations++;
      }
    }
  }

  const score = totalCitations === 0 ? 1.0 : validCitations / totalCitations;
  return {
    metric: "Citation Validity",
    score,
    threshold: 1.0,
    passed: score >= 1.0,
    unit: "%",
    details: `${validCitations}/${totalCitations} citations resolved cleanly`,
  };
}

/** 2. Groundedness Score Gate: Average critic score >= 0.85 */
export function scoreGroundedness(questions: EvaluatedQuestion[]): MetricResult {
  if (questions.length === 0) {
    return { metric: "Groundedness Score", score: 0, threshold: 0.85, passed: false };
  }

  const sum = questions.reduce((acc, q) => acc + q.groundedness, 0);
  const avg = sum / questions.length;

  return {
    metric: "Groundedness Score",
    score: Number(avg.toFixed(3)),
    threshold: 0.85,
    passed: avg >= 0.85,
    details: `Mean groundedness: ${avg.toFixed(3)} across ${questions.length} questions`,
  };
}

/** 3. Category Coverage Gate: Non-empty categories per repo >= 10 of 13 */
export function scoreCategoryCoverage(questions: EvaluatedQuestion[]): MetricResult {
  const categoriesPresent = new Set(questions.map((q) => q.category));
  const count = categoriesPresent.size;

  return {
    metric: "Category Coverage",
    score: count,
    threshold: 10,
    passed: count >= 10,
    unit: "categories",
    details: `${count}/13 unique question categories populated`,
  };
}

/** 4. Duplicate Rate Gate: Question duplication above 0.90 similarity < 3% */
export function scoreDuplicateRate(questions: EvaluatedQuestion[]): MetricResult {
  if (questions.length < 2) {
    return { metric: "Duplicate Rate", score: 0, threshold: 0.03, passed: true, unit: "%" };
  }

  let duplicates = 0;
  const totalPairs = (questions.length * (questions.length - 1)) / 2;

  // Simple string overlap / Jaccard similarity proxy for eval script
  for (let i = 0; i < questions.length; i++) {
    for (let j = i + 1; j < questions.length; j++) {
      const q1Words = new Set(questions[i]!.stem.toLowerCase().split(/\s+/));
      const q2Words = new Set(questions[j]!.stem.toLowerCase().split(/\s+/));
      const intersection = [...q1Words].filter((w) => q2Words.has(w)).length;
      const union = new Set([...q1Words, ...q2Words]).size;
      const similarity = union > 0 ? intersection / union : 0;
      if (similarity > 0.90) {
        duplicates++;
      }
    }
  }

  const rate = totalPairs > 0 ? duplicates / totalPairs : 0;
  return {
    metric: "Duplicate Rate",
    score: Number(rate.toFixed(4)),
    threshold: 0.03,
    passed: rate < 0.03,
    unit: "%",
    details: `${duplicates} near-duplicate pairs out of ${totalPairs} candidate pairs`,
  };
}

/** 5. Cost per Repo Gate: No > 20% regression against baseline */
export function scoreCostRegression(
  actualCostCents: number,
  baselineCostCents: number,
): MetricResult {
  const ratio = baselineCostCents > 0 ? actualCostCents / baselineCostCents : 1.0;
  const regression = ratio - 1.0;

  return {
    metric: "Cost Regression",
    score: Number((actualCostCents / 100).toFixed(2)),
    threshold: Number((baselineCostCents * 1.2 / 100).toFixed(2)),
    passed: regression <= 0.20,
    unit: "USD",
    details: `Spent $${(actualCostCents / 100).toFixed(2)} vs baseline $${(baselineCostCents / 100).toFixed(2)} (+${(regression * 100).toFixed(1)}%)`,
  };
}

/** 6. P95 Time-to-First-Question Gate: Wall clock latency < 45 seconds */
export function scoreTimeToFirstQuestion(p95LatencyMs: number): MetricResult {
  const seconds = p95LatencyMs / 1_000;
  return {
    metric: "p95 Time-to-First-Question",
    score: Number(seconds.toFixed(2)),
    threshold: 45,
    passed: seconds < 45,
    unit: "s",
    details: `p95 streaming latency: ${seconds.toFixed(1)}s`,
  };
}

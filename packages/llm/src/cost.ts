import { PrepoError } from "@prepo/shared";
import pricingJson from "./pricing.json" with { type: "json" };
import type { CallResult, ProviderId, Usage } from "./types.js";

export interface Rate {
  /** US cents per 1,000,000 tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const pricing = pricingJson as unknown as {
  fetchedAt: string;
  sources: Record<string, string>;
  rates: Record<string, Rate | null>;
};

export const PRICING_FETCHED_AT = pricing.fetchedAt;

export function rateFor(model: string): Rate | null {
  return pricing.rates[model] ?? null;
}

/**
 * Returns null — not zero — when we have no published rate for a model.
 * A missing price must read as "unknown" in the UI. Showing $0.00 for a model
 * that is quietly costing money is the kind of small lie that loses trust.
 */
export function costCents(model: string, usage: Usage): number | null {
  const rate = rateFor(model);
  if (!rate) return null;

  const million = 1_000_000;
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return (
    (uncached * rate.input) / million +
    (usage.cachedTokens * rate.cacheRead) / million +
    (usage.outputTokens * rate.output) / million
  );
}

export interface UsageEvent {
  stage: string;
  provider: ProviderId;
  model: string;
  usage: Usage;
  costCents: number | null;
}

/**
 * Enforces the per-run budget and accumulates spend. The check happens
 * *before* each call rather than after, so a run stops at the ceiling instead
 * of discovering it has blown through it.
 */
export class CostMeter {
  spentCents = 0;
  readonly events: UsageEvent[] = [];
  readonly unpricedModels = new Set<string>();

  constructor(
    readonly budgetCents: number,
    private readonly onEvent?: (event: UsageEvent) => void | Promise<void>,
  ) {}

  assertWithinBudget(): void {
    if (this.budgetCents > 0 && this.spentCents >= this.budgetCents) {
      throw new PrepoError(
        "budget_exceeded",
        `Run stopped at the ${formatCents(this.budgetCents)} budget cap. Raise BUDGET_CENTS_PER_RUN to continue.`,
      );
    }
  }

  record<T>(result: CallResult<T>, stage: string): CallResult<T> {
    const cost = costCents(result.model, result.usage);
    if (cost === null) this.unpricedModels.add(result.model);
    else this.spentCents += cost;

    const event: UsageEvent = {
      stage,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      costCents: cost,
    };
    this.events.push(event);
    void this.onEvent?.(event);
    return result;
  }

  get totals(): Usage {
    return this.events.reduce<Usage>(
      (acc, e) => ({
        inputTokens: acc.inputTokens + e.usage.inputTokens,
        outputTokens: acc.outputTokens + e.usage.outputTokens,
        cachedTokens: acc.cachedTokens + e.usage.cachedTokens,
      }),
      { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
    );
  }
}

export function formatCents(cents: number): string {
  if (cents < 1) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Pre-run estimate, shown before a single token is spent.
 *
 * The numbers below are derived from the pipeline's actual shape rather than
 * guessed: one summary call per analysed file at roughly file size in, 60
 * tokens out; one dossier call over the rollups; ten generator calls sharing a
 * cached prefix; one critic pass per generated question.
 */
export function estimateRun(input: {
  analysedFiles: number;
  totalBytes: number;
  fastModel: string;
  balancedModel: string;
  frontierModel: string;
  questionTarget: number;
}): { cents: number | null; breakdown: Array<{ stage: string; cents: number | null }> } {
  const tokensFromBytes = (bytes: number) => Math.ceil(bytes / 3.6);

  const summaryIn = tokensFromBytes(input.totalBytes);
  const summaryOut = input.analysedFiles * 60;

  const rollupTokens = input.analysedFiles * 70;
  const dossierIn = rollupTokens + 4_000;
  const dossierOut = 6_000;

  const generators = 10;
  const genIn = generators * (rollupTokens * 0.25 + 3_000);
  const genOut = input.questionTarget * 700;

  const criticIn = input.questionTarget * 2_500;
  const criticOut = input.questionTarget * 250;

  const rows: Array<{ stage: string; model: string; usage: Usage }> = [
    {
      stage: "04 · file summaries",
      model: input.fastModel,
      usage: { inputTokens: summaryIn, outputTokens: summaryOut, cachedTokens: 0 },
    },
    {
      stage: "05 · dossier",
      model: input.frontierModel,
      usage: { inputTokens: dossierIn, outputTokens: dossierOut, cachedTokens: 0 },
    },
    {
      stage: "06 · questions",
      model: input.balancedModel,
      // Nine of ten generators read the shared prefix from cache.
      usage: { inputTokens: genIn, outputTokens: genOut, cachedTokens: genIn * 0.7 },
    },
    {
      stage: "07 · verification",
      model: input.balancedModel,
      usage: { inputTokens: criticIn, outputTokens: criticOut, cachedTokens: 0 },
    },
  ];

  const breakdown = rows.map((r) => ({ stage: r.stage, cents: costCents(r.model, r.usage) }));
  const anyUnknown = breakdown.some((b) => b.cents === null);

  return {
    cents: anyUnknown ? null : breakdown.reduce((sum, b) => sum + (b.cents ?? 0), 0),
    breakdown,
  };
}

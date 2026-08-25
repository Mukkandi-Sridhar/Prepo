import { describe, expect, it } from "vitest";
import { specFor, defaultProvider, createProvider } from "../router.js";
import { CostMeter } from "../cost.js";

describe("LLM Router & Cost Meter", () => {
  it("resolves tier specs for Anthropic", () => {
    const fastSpec = specFor("anthropic", "fast");
    const frontierSpec = specFor("anthropic", "frontier");

    expect(fastSpec.id).toBeDefined();
    expect(frontierSpec.id).toBeDefined();
    expect(frontierSpec.contextTokens).toBeGreaterThanOrEqual(fastSpec.contextTokens);
  });

  it("creates provider adapter instances", () => {
    const provider = createProvider({ provider: "anthropic", apiKey: "test-key" });
    expect(provider.id).toBe("anthropic");
  });

  it("determines default provider from environment", () => {
    const provider = defaultProvider();
    expect(["anthropic", "openai", "google", "openrouter", "ollama"]).toContain(provider);
  });

  it("calculates LLM token costs correctly in CostMeter", () => {
    const meter = new CostMeter(200);
    meter.record(
      {
        value: "test response",
        model: "claude-sonnet-5",
        provider: "anthropic",
        usage: {
          inputTokens: 10_000,
          outputTokens: 1_000,
          cachedTokens: 5_000,
        },
      },
      "test-stage",
    );

    expect(meter.events.length).toBe(1);
    expect(meter.spentCents).toBeGreaterThan(0);
  });
});

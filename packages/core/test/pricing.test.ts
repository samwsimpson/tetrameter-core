import { describe, it, expect } from "vitest";
import {
  callCost,
  resolvePricing,
  isModelSpecificPricing,
  PRICING,
  PRICING_ROWS,
  PRICING_CLASS_MEDIAN,
  RESTATEMENTS,
  classifyModel,
  resolveModelEnergy,
} from "../src/index.js";
import type { CallRecord } from "../src/index.js";

function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "c1",
    timestamp: "2026-07-31T10:00:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputTokens: 1_000_000,
    outputTokens: 0,
    ...over,
  };
}

describe("pricing catalogue", () => {
  it("loaded a broad catalogue, indexed under both spellings", () => {
    expect(PRICING_ROWS.length).toBeGreaterThan(1000);
    // More keys than rows: every id whose name contains a "4.5"-style version is
    // also registered as "4-5", so whichever spelling arrives resolves. See
    // factors/normalize.ts for why that is not optional.
    expect(PRICING.size).toBeGreaterThanOrEqual(PRICING_ROWS.length);
    const aliased = PRICING.size - PRICING_ROWS.length;
    expect(aliased).toBeGreaterThan(0);
  });

  it("prices the models we actually care about", () => {
    const sonnet = resolvePricing("claude-sonnet-5", "mid")!;
    expect(isModelSpecificPricing(sonnet)).toBe(true);
    expect(sonnet.inputPer1m).toBe(2);
    expect(sonnet.outputPer1m).toBe(10);
    expect(sonnet.cachedInputPer1m).toBe(0.2);
  });

  it("keeps output dearer than input across the catalogue", () => {
    const violations = PRICING_ROWS.filter(([, i, o]) => o > 0 && i > 0 && o < i);
    // A handful of providers do invert this; it should stay rare, not become normal.
    expect(violations.length / PRICING_ROWS.length).toBeLessThan(0.1);
  });

  it("never carries a negative price", () => {
    for (const [, i, o, c] of PRICING_ROWS) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  it("strips a provider prefix when the bare name is known", () => {
    const direct = resolvePricing("deepseek-r1", "reasoning");
    const prefixed = resolvePricing("some-gateway/deepseek-r1", "reasoning");
    expect(prefixed?.id).toBe(direct?.id);
  });

  it("falls back to a class median rather than guessing at a near-miss", () => {
    // Fuzzy matching is how Opus silently gets priced as Haiku. We refuse.
    const unknown = resolvePricing("totally-made-up-model-v9", "large")!;
    expect(isModelSpecificPricing(unknown)).toBe(false);
    expect(unknown.inputPer1m).toBe(PRICING_CLASS_MEDIAN.large.inputPer1m);
  });

  it("orders class medians sensibly by capability", () => {
    expect(PRICING_CLASS_MEDIAN.small.outputPer1m).toBeLessThan(
      PRICING_CLASS_MEDIAN.mid.outputPer1m,
    );
    expect(PRICING_CLASS_MEDIAN.mid.outputPer1m).toBeLessThan(
      PRICING_CLASS_MEDIAN.large.outputPer1m,
    );
  });
});

describe("cost computation", () => {
  it("computes list price exactly for a known model", () => {
    // 1M input tokens of claude-sonnet-5 at $2/1M.
    expect(callCost(call()).value).toBeCloseTo(2.0, 6);
  });

  it("charges cached input at the discounted rate", () => {
    // Disjoint fields: the same million tokens, sent fresh or read from cache.
    // This previously set both to 1M, which under the collector's actual
    // semantics is two million tokens rather than one million of which some
    // were cached — it encoded the subtraction bug rather than the intent.
    const uncached = callCost(call({ inputTokens: 1_000_000, cachedTokens: 0 }));
    const cached = callCost(call({ inputTokens: 0, cachedTokens: 1_000_000 }));
    expect(cached.value).toBeLessThan(uncached.value / 5);
  });

  it("counts reasoning tokens as billed output", () => {
    const plain = callCost(call({ inputTokens: 0, outputTokens: 1_000 }));
    const thinking = callCost(call({ inputTokens: 0, outputTokens: 1_000, reasoningTokens: 9_000 }));
    expect(thinking.value).toBeCloseTo(plain.value * 10, 6);
  });

  it("prefers billed cost over the catalogue and marks it exact", () => {
    const billed = callCost(call({ billedCostUsd: 0.0123 }));
    expect(billed.value).toBe(0.0123);
    expect(billed.tier).toBe(4);
    expect(billed.low).toBe(billed.high);
  });

  it("bands a catalogue hit downward only — list price is the ceiling", () => {
    // The only unknown is the customer's negotiated discount.
    const cost = callCost(call());
    expect(cost.tier).toBe(2);
    expect(cost.high).toBe(cost.value);
    expect(cost.low).toBeLessThan(cost.value);
  });

  it("bands a class fallback widely in both directions at tier 1", () => {
    const cost = callCost(call({ model: "totally-made-up-model-v9" }));
    expect(cost.tier).toBe(1);
    expect(cost.low).toBeLessThan(cost.value);
    expect(cost.high).toBeGreaterThan(cost.value);
  });

  it("charges a cache write at a premium over ordinary input", () => {
    // The correction 2026.08.7 exists for. A million tokens written into the
    // cache is billed at 1.25x a million sent fresh, not at parity — and every
    // adapter folded writes into inputTokens at 1.0x until this landed, so a
    // write turn read ~19% cheaper than the invoice said.
    const fresh = callCost(call({ inputTokens: 1_000_000 }));
    const written = callCost(call({ inputTokens: 0, cacheWriteTokens: 1_000_000 }));
    expect(written.value).toBeCloseTo(fresh.value * 1.25, 6);
  });

  it("carries the one-hour TTL in the ceiling, because metadata cannot tell us which applied", () => {
    // A response says how many tokens were written, never for how long. 1.25x is
    // the five-minute default and 2x the one-hour; the gap belongs in the band
    // rather than being resolved by picking a side.
    const written = callCost(call({ inputTokens: 0, cacheWriteTokens: 1_000_000 }));
    const fresh = callCost(call({ inputTokens: 1_000_000 }));
    expect(written.high).toBeCloseTo(fresh.value * 2.0, 6);
    expect(written.high).toBeGreaterThan(written.value);
  });

  it("prices a sender that does not split writes out exactly as before", () => {
    // Non-breaking by construction: absent means the writes are still inside
    // inputTokens at 1.0x, which is every row stored before this change and
    // every sender that has not upgraded.
    const before = callCost(call({ inputTokens: 1_000_000 }));
    const after = callCost(call({ inputTokens: 1_000_000, cacheWriteTokens: undefined }));
    expect(after.value).toBe(before.value);
    expect(after.high).toBe(before.high);
  });

  it("attaches a citable pricing source", () => {
    const [source] = callCost(call()).sources;
    expect(source?.kind).toBe("pricing");
    expect(source?.source).toContain("LiteLLM");
    expect(source?.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("pricing restatement", () => {
  it("records that the bootstrap stubs were materially wrong", () => {
    const entry = RESTATEMENTS.forFactor("pricing.*")[0];
    expect(entry).toBeDefined();
    expect(entry!.materialityEstimate).toBeLessThan(0);
    expect(entry!.reason).toContain("Opus");
  });
});

describe("both spellings resolve — the SiteBeacon fleet", () => {
  // The collector normalises "4.5" to "4-5" so one model does not appear as two
  // rows. But this catalogue stores some ids WITH dots, so the normalised form
  // missed the lookup and fell back to a class median — silently, on live
  // traffic, producing plausible-looking numbers that were simply wrong.
  //
  // These are SiteBeacon's actual default fleet, verbatim from
  // src/lib/recognition/providers.ts, in both spellings.
  const FLEET_RAW = [
    "anthropic/claude-haiku-4.5",
    "openai/gpt-4o-mini",
    "google/gemini-2.5-flash",
    "perplexity/sonar",
    "xai/grok-4.1-fast-non-reasoning",
  ];

  it("resolves every fleet model from the catalogue, raw or normalised", () => {
    for (const raw of FLEET_RAW) {
      const normalised = raw.replace(/(\d)\.(\d)/g, "$1-$2");
      for (const form of [raw, normalised]) {
        const p = resolvePricing(form, classifyModel(form))!;
        expect(
          isModelSpecificPricing(p),
          `${form} fell back to a class median`,
        ).toBe(true);
      }
    }
  });

  it("gives the same price for both spellings of one model", () => {
    // If these diverge, one row is being priced differently from the other and
    // a model breakdown would disagree with itself.
    for (const raw of FLEET_RAW) {
      const normalised = raw.replace(/(\d)\.(\d)/g, "$1-$2");
      const a = resolvePricing(raw, classifyModel(raw))!;
      const b = resolvePricing(normalised, classifyModel(normalised))!;
      expect(a.inputPer1m).toBe(b.inputPer1m);
      expect(a.outputPer1m).toBe(b.outputPer1m);
    }
  });

  it("resolves a benchmarked open-weight model in both spellings", () => {
    // ML.ENERGY ids carry dots too. Missing here demotes a genuinely measured
    // model to a Tier 1 class average.
    expect(resolveModelEnergy("meta-llama/llama-3.1-8b-instruct").tier).toBe(2);
    expect(resolveModelEnergy("meta-llama/llama-3-1-8b-instruct").tier).toBe(2);
  });
});

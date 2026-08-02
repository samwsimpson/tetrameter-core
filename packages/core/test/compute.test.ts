import { describe, it, expect } from "vitest";
import {
  computeCall,
  callEnergy,
  callCarbon,
  callCost,
  callLand,
  computeTrace,
  rollup,
  rollupTotal,
  groupIntoTraces,
  sci,
  efficiencyTrend,
  resolveGrid,
  MarginalSignalUnavailableError,
  classifyModel,
  quantity,
} from "../src/index.js";
import type { CallRecord } from "../src/index.js";

function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "c1",
    timestamp: "2026-07-31T10:00:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-5",
    inputTokens: 1000,
    outputTokens: 500,
    ...over,
  };
}

describe("model classification", () => {
  it("routes reasoning models by pattern", () => {
    expect(classifyModel("o3-mini")).toBe("reasoning");
    expect(classifyModel("deepseek-r1")).toBe("reasoning");
  });

  it("routes small, mid and large models", () => {
    expect(classifyModel("claude-haiku-4-5")).toBe("small");
    expect(classifyModel("claude-sonnet-5")).toBe("mid");
    expect(classifyModel("claude-opus-5")).toBe("large");
  });

  it("falls back rather than guessing on an unknown model", () => {
    expect(classifyModel("some-new-model-nobody-has-seen")).toBe("mid");
    expect(classifyModel("some-new-model-nobody-has-seen", "small")).toBe("small");
  });

  it("does not match size tokens inside longer words", () => {
    // "gemini" contains "mini". An unanchored pattern classified every Gemini call
    // as a small model and understated it roughly fourfold — silently, which is
    // the worst kind of wrong. Anchor everything.
    expect(classifyModel("gemini-3-pro")).toBe("mid");
    expect(classifyModel("gemini-2.5-flash")).toBe("mid");
    expect(classifyModel("gpt-4o-mini")).toBe("small");
    expect(classifyModel("gemini-2.5-flash-lite")).toBe("small");
  });

  it("reads parameter-count tokens at the right magnitude", () => {
    expect(classifyModel("llama-3.1-8b-instruct")).toBe("small");
    expect(classifyModel("llama-3.1-405b-instruct")).toBe("large");
    expect(classifyModel("llama-3.3-70b-instruct")).toBe("mid");
  });
});

describe("call computation", () => {
  it("produces all four resources with bands", () => {
    const f = computeCall(call());
    for (const q of [f.energy, f.carbon, f.water, f.cost]) {
      expect(q.value).toBeGreaterThan(0);
      expect(q.low).toBeLessThanOrEqual(q.value);
      expect(q.high).toBeGreaterThanOrEqual(q.value);
    }
  });

  it("charges output tokens far more than input tokens", () => {
    const outputHeavy = callEnergy(call({ inputTokens: 100, outputTokens: 2000 }));
    const inputHeavy = callEnergy(call({ inputTokens: 2000, outputTokens: 100 }));
    expect(outputHeavy.value).toBeGreaterThan(inputHeavy.value * 3);
  });

  it("counts reasoning tokens as output — they are decoded and billed as such", () => {
    const withReasoning = callEnergy(call({ model: "o3", reasoningTokens: 5000 }));
    const without = callEnergy(call({ model: "o3" }));
    expect(withReasoning.value).toBeGreaterThan(without.value * 5);
  });

  it("makes cached tokens dramatically cheaper in energy", () => {
    // The same ten thousand tokens, read from cache rather than sent fresh.
    const cached = callEnergy(call({ inputTokens: 0, cachedTokens: 10_000 }));
    const uncached = callEnergy(call({ inputTokens: 10_000, cachedTokens: 0 }));
    expect(cached.value).toBeLessThan(uncached.value);
  });

  it("includes embodied emissions on top of operational", () => {
    const carbon = callCarbon(call());
    const energy = callEnergy(call());
    const grid = resolveGrid("GLOBAL", "average");
    const operationalOnly = energy.value * grid.gco2ePerKwh;
    expect(carbon.value).toBeGreaterThan(operationalOnly);
  });

  it("prefers billed cost over estimated, and marks it exact", () => {
    const billed = callCost(call({ billedCostUsd: 0.0123 }));
    expect(billed.value).toBe(0.0123);
    expect(billed.tier).toBe(4);
    expect(billed.low).toBe(billed.high);
  });

  it("caps tier at 2 for third-party APIs with no provider disclosure", () => {
    // Provider transparency is the binding constraint, not our engineering effort.
    expect(computeCall(call({ billedCostUsd: 0.01 })).tier).toBeLessThanOrEqual(2);
  });

  it("lifts the energy figure to tier 3 when actual energy was measured", () => {
    expect(callEnergy(call({ measuredWh: 0.5 })).tier).toBe(3);
    expect(callEnergy(call()).tier).toBeLessThanOrEqual(2);
  });

  it("does not let a measured energy figure lift the carbon figure above its grid factor", () => {
    // A precisely measured kWh multiplied by a tier-1 annual grid average does not
    // produce a tier-3 carbon number. Grid intensity is primary evidence, so it
    // caps carbon — unlike PUE, which is an overhead and does not.
    const measured = computeCall(call({ measuredWh: 0.5 }));
    expect(measured.energy.tier).toBe(3);
    expect(measured.carbon.tier).toBe(1);
    expect(measured.tier).toBe(1);
  });

  it("does not let overhead coefficients pin every figure to tier 1 forever", () => {
    // PUE and host overhead are generic estimates and always will be. Treating
    // them as tier-determining made the scale degenerate: every figure sat at
    // Tier 1 regardless of evidence, so the tier carried no information at all.
    // The first rendered report showed four identical bars, which is what caught it.
    const benchmarked = computeCall(call({ model: "meta-llama/llama-3.1-70b-instruct" }));
    expect(benchmarked.energy.tier).toBe(2);
    // The overhead factors are still cited — they widen the band, they just do
    // not reclassify the method.
    expect(benchmarked.energy.sources.map((s) => s.id)).toContain("overhead.pue");
  });

  it("still lets primary evidence cap what is derived from it", () => {
    expect(computeCall(call({ model: "claude-sonnet-5" })).energy.tier).toBe(1);
    expect(computeCall(call({ model: "meta-llama/llama-3.1-70b-instruct" })).carbon.tier).toBe(1);
  });
});

describe("grid signal discipline", () => {
  const ESTIMATED = { allowEstimatedMarginal: true };

  it("returns the average signal by default — correct for inventory", () => {
    expect(resolveGrid("US").signal).toBe("average");
  });

  it("reports marginal far above average where low-carbon baseload dominates", () => {
    // France: very low average thanks to nuclear, much higher marginal because the
    // unit that follows load is usually gas. Swapping the two is the classic error.
    const avg = resolveGrid("FR", "average");
    const marginal = resolveGrid("FR", "marginal", ESTIMATED);
    expect(marginal.gco2ePerKwh).toBeGreaterThan(avg.gco2ePerKwh * 3);
  });

  it("reports marginal close to average in a coal-heavy grid", () => {
    // Poland: coal sets both the average and the margin, so the two converge.
    // If this ever diverged sharply the fossil-mix inference would be broken.
    const avg = resolveGrid("PL", "average");
    const marginal = resolveGrid("PL", "marginal", ESTIMATED);
    const ratio = marginal.gco2ePerKwh / avg.gco2ePerKwh;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(2);
  });

  it("refuses an inferred marginal unless the caller explicitly opts in", () => {
    // Every marginal figure in the static table is an inference, not a measured
    // MOER. Handing one to a reduction claim by default is how savings get
    // overstated in a document that goes to a regulator.
    expect(() => resolveGrid("FR", "marginal")).toThrow(MarginalSignalUnavailableError);
    expect(() => resolveGrid("FR", "marginal", ESTIMATED)).not.toThrow();
  });

  it("refuses outright where fossil generation is too thin to infer a margin", () => {
    // Norway and Sweden run ~1% fossil. Inferring a marginal 20x their average off
    // that sliver would look authoritative and mean nothing.
    expect(() => resolveGrid("NO", "marginal", ESTIMATED)).toThrow(MarginalSignalUnavailableError);
    expect(() => resolveGrid("GLOBAL", "marginal", ESTIMATED)).toThrow(
      MarginalSignalUnavailableError,
    );
  });

  it("marks an inferred marginal as estimated and a measured average as not", () => {
    expect(resolveGrid("FR", "marginal", ESTIMATED).estimated).toBe(true);
    expect(resolveGrid("FR", "average").estimated).toBe(false);
  });

  it("produces a materially different carbon figure per signal", () => {
    const avg = callCarbon(call({ region: "FR" }), { signal: "average" });
    const marginal = callCarbon(call({ region: "FR" }), {
      signal: "marginal",
      allowEstimatedMarginal: true,
    });
    expect(marginal.value).toBeGreaterThan(avg.value * 3);
  });

  it("resolves a sub-national zone to its country and says so in the reference", () => {
    // We hold country annual averages only. Silently returning US data for a
    // CAISO query without flagging the downgrade would mislead an auditor.
    const caiso = resolveGrid("US-CAISO");
    expect(caiso.gco2ePerKwh).toBe(resolveGrid("US").gco2ePerKwh);
    expect(caiso.ref.note).toContain("sub-national");
  });

  it("falls back to the default zone for an unknown region rather than throwing", () => {
    expect(resolveGrid("NOT-A-ZONE").gco2ePerKwh).toBe(resolveGrid("GLOBAL").gco2ePerKwh);
  });
});

describe("trace aggregation", () => {
  const agentTrace = {
    traceId: "t1",
    calls: [
      call({ id: "a", inputTokens: 1000, outputTokens: 200 }),
      call({ id: "b", inputTokens: 1800, outputTokens: 200 }),
      call({ id: "c", inputTokens: 2600, outputTokens: 400 }),
    ],
    outcome: "ticket resolved",
    outcomeCount: 1,
  };

  it("sums a trace to more than any single call", () => {
    const t = computeTrace(agentTrace);
    const single = computeCall(agentTrace.calls[0]!);
    expect(t.carbon.value).toBeGreaterThan(single.carbon.value);
    expect(t.callCount).toBe(3);
  });

  it("measures the invisible share the customer is billed for but cannot see", () => {
    const t = computeTrace(agentTrace);
    // First two calls' output is intermediate scaffolding: 200 + 200 = 400 of 6200.
    expect(t.invisibleTokens).toBe(400);
    expect(t.invisibleShare).toBeCloseTo(400 / 6200, 5);
  });

  it("counts reasoning tokens as invisible", () => {
    const t = computeTrace({
      traceId: "t2",
      calls: [call({ id: "x", model: "o3", reasoningTokens: 4000, outputTokens: 100 })],
    });
    expect(t.invisibleTokens).toBe(4000);
  });

  it("groups loose calls by traceId", () => {
    const traces = groupIntoTraces([
      call({ id: "a", traceId: "t1" }),
      call({ id: "b", traceId: "t1" }),
      call({ id: "c", traceId: "t2" }),
    ]);
    expect(traces).toHaveLength(2);
    expect(traces.find((t) => t.traceId === "t1")?.calls).toHaveLength(2);
  });

  it("keeps uninstrumented calls as single-call traces rather than dropping them", () => {
    const traces = groupIntoTraces([call({ id: "lonely" })]);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.calls[0]?.id).toBe("lonely");
  });

  it("orders calls within a trace chronologically", () => {
    const traces = groupIntoTraces([
      call({ id: "late", traceId: "t", timestamp: "2026-07-31T10:00:02.000Z" }),
      call({ id: "early", traceId: "t", timestamp: "2026-07-31T10:00:01.000Z" }),
    ]);
    expect(traces[0]?.calls.map((c) => c.id)).toEqual(["early", "late"]);
  });
});

describe("SCI", () => {
  it("divides carbon by the functional unit", () => {
    const t = computeTrace({ traceId: "t", calls: [call()] });
    const perUnit = sci(t, 4);
    expect(perUnit.value).toBeCloseTo(t.carbon.value / 4, 10);
    expect(perUnit.unit).toBe("gCO2e/unit");
  });

  it("rejects a non-positive functional unit count", () => {
    const t = computeTrace({ traceId: "t", calls: [call()] });
    expect(() => sci(t, 0)).toThrow(RangeError);
  });
});

describe("efficiency trend", () => {
  it("reports improvement as work done per gram, not as a falling total", () => {
    const mk = (period: string, v: number) => ({
      period,
      gco2ePerOutcome: quantity({ value: v, low: v * 0.6, high: v * 1.8, unit: "gCO2e/unit" as const, tier: 2 as const }),
      outcomes: 1000,
    });
    const trend = efficiencyTrend([mk("2026-Q2", 2.1), mk("2026-Q1", 8.4), mk("2026-Q3", 2.0)]);

    expect(trend.points.map((p) => p.period)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3"]);
    expect(trend.improvementFactor).toBeCloseTo(4.2, 5);
  });

  it("returns no factor from a single data point", () => {
    const trend = efficiencyTrend([
      {
        period: "2026-Q1",
        gco2ePerOutcome: quantity({ value: 1, unit: "gCO2e/unit", tier: 2 }),
        outcomes: 10,
      },
    ]);
    expect(trend.improvementFactor).toBeUndefined();
  });
});

describe("land as the fourth resource", () => {
  it("computes land for every call, scaling with energy", () => {
    const small = callLand(call({ outputTokens: 100 }));
    const large = callLand(call({ outputTokens: 10_000 }));
    expect(small.value).toBeGreaterThan(0);
    expect(large.value).toBeGreaterThan(small.value * 5);
    expect(small.unit).toBe("cm2");
  });

  it("varies land by serving region, because generation mix differs", () => {
    const gb = callLand(call({ region: "GB" }));
    const fr = callLand(call({ region: "FR" }));
    expect(gb.value).toBeGreaterThan(fr.value * 2);
  });

  it("returns all four resources plus cost from computeCall", () => {
    const f = computeCall(call());
    expect(f.energy.unit).toBe("kWh");
    expect(f.carbon.unit).toBe("gCO2e");
    expect(f.water.unit).toBe("L");
    expect(f.land.unit).toBe("cm2");
    expect(f.cost.unit).toBe("USD");
  });

  it("treats land intensity as an overhead, not as tier-determining", () => {
    // Same rule as PUE and water: it widens the band without reclassifying the
    // method that produced the energy figure.
    const benchmarked = computeCall(call({ model: "meta-llama/llama-3.1-70b-instruct" }));
    expect(benchmarked.land.tier).toBe(2);
  });
});

/*
 * A failed trace consumed resources and produced nothing.
 *
 * Raised by an integration wiring up per-outcome reporting: counting a wholly
 * failed trace as an achieved outcome inflates the denominator of the metric we
 * lead with, so efficiency improves exactly when a customer burns tokens on work
 * that did not land.
 */
describe("outcome counting when calls fail", () => {
  const at = (i: number) => `2026-08-02T05:0${i}:00.000Z`;
  const ok = (i: number) => ({
    id: `c${i}`, timestamp: at(i), provider: "anthropic", model: "claude-sonnet-5",
    region: "US", inputTokens: 100, outputTokens: 50,
  });
  const failed = (i: number) => ({ ...ok(i), error: "429 rate limited" });

  it("counts one outcome for a trace that succeeded", () => {
    expect(computeTrace({ traceId: "t", calls: [ok(1), ok(2)] }).outcomeCount).toBe(1);
  });

  it("counts no outcome when every call failed", () => {
    expect(computeTrace({ traceId: "t", calls: [failed(1), failed(2)] }).outcomeCount).toBe(0);
  });

  it("still counts the outcome when a retry succeeded", () => {
    // The failure is waste the numerator already carries; the outcome landed.
    expect(computeTrace({ traceId: "t", calls: [failed(1), ok(2)] }).outcomeCount).toBe(1);
  });

  it("still charges the energy of a wholly failed trace", () => {
    const t = computeTrace({ traceId: "t", calls: [failed(1), failed(2)] });
    // Zero outcomes must not mean zero footprint — the tokens were burned.
    expect(t.carbon.value).toBeGreaterThan(0);
    expect(t.energy.value).toBeGreaterThan(0);
  });

  it("lets an explicit outcomeCount win over the inference", () => {
    expect(
      computeTrace({ traceId: "t", outcomeCount: 3, calls: [failed(1), failed(2)] }).outcomeCount,
    ).toBe(3);
    expect(
      computeTrace({ traceId: "t", outcomeCount: 0, calls: [ok(1)] }).outcomeCount,
    ).toBe(0);
  });

  it("makes per-outcome carbon worse when work fails, not better", () => {
    const succeeded = rollupTotal([{ traceId: "a", calls: [ok(1)] }]);
    const withAFailure = rollupTotal([
      { traceId: "a", calls: [ok(1)] },
      { traceId: "b", calls: [failed(2)] },
    ]);
    // Same one outcome in both, but the failed attempt adds carbon to it — so
    // the headline figure gets worse, which is the honest direction.
    expect(withAFailure.outcomes).toBe(succeeded.outcomes);
    expect(withAFailure.sci!.value).toBeGreaterThan(succeeded.sci!.value);
  });
});

/*
 * Cached and fresh input are disjoint.
 *
 * Found in live data the day a portfolio product turned prompt caching on: the
 * engine subtracted cachedTokens from inputTokens, but the collector has always
 * sent them separately. A turn reading more from cache than it sent fresh -
 * the normal case once caching works - priced its fresh input at zero.
 */
describe("cached input accounting", () => {
  const c = (over: Partial<CallRecord>): CallRecord => ({
    id: "c", timestamp: "2026-08-02T17:55:52.000Z", provider: "anthropic",
    model: "claude-sonnet-4-6", region: "US", inputTokens: 0, outputTokens: 0, ...over,
  });

  it("charges fresh input even when the cache read is larger", () => {
    // The measured turn: 511 fresh, 8,450 read from cache.
    const withCache = callCost(c({ inputTokens: 511, outputTokens: 253, cachedTokens: 8450 }));
    const freshOnly = callCost(c({ inputTokens: 511, outputTokens: 253 }));
    // Reading from cache costs something, so the cached turn must exceed the
    // one that sent the same fresh tokens and read nothing.
    expect(withCache.value).toBeGreaterThan(freshOnly.value);
  });

  it("does not treat a large cache read as cancelling the fresh tokens", () => {
    const a = callCost(c({ inputTokens: 511, outputTokens: 0, cachedTokens: 8450 }));
    const b = callCost(c({ inputTokens: 0, outputTokens: 0, cachedTokens: 8450 }));
    expect(a.value).toBeGreaterThan(b.value);
  });

  it("still makes caching cheaper than sending the same tokens fresh", () => {
    const cached = callCost(c({ inputTokens: 511, outputTokens: 253, cachedTokens: 8450 }));
    const uncached = callCost(c({ inputTokens: 8961, outputTokens: 253 }));
    expect(cached.value).toBeLessThan(uncached.value);
    // The saving should be large but not total — the fresh tokens and the read
    // both cost real money.
    const saving = (uncached.value - cached.value) / uncached.value;
    expect(saving).toBeGreaterThan(0.6);
    expect(saving).toBeLessThan(0.95);
  });

  it("applies the same rule to energy", () => {
    const a = callEnergy(c({ inputTokens: 511, outputTokens: 253, cachedTokens: 8450 }));
    const b = callEnergy(c({ inputTokens: 0, outputTokens: 253, cachedTokens: 8450 }));
    expect(a.value).toBeGreaterThan(b.value);
  });
});

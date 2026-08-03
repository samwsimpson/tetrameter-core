/**
 * Per-call computation: metadata in, four resources out.
 *
 * The chain is:
 *
 *   tokens ──▶ accelerator energy ──▶ × host overhead ──▶ × PUE ──▶ facility energy
 *                (ML.ENERGY, measured)    (host CPU/RAM,                  │
 *                                          idle + reserve)                │
 *                                    ┌───────────────┬───────────────┐
 *                                    ▼               ▼               ▼
 *                              × grid intensity  × water     (+ embodied uplift)
 *                                    │            intensity
 *                                    ▼               ▼
 *                                 carbon           water
 *
 * Energy is the pivot. Carbon, water and — through model choice — cost all hang
 * off it, which is why the whole model is built around kWh rather than around
 * carbon. Get energy right and the rest follows.
 */

import {
  quantity,
  scale,
  scaleBy,
  applyOverhead,
  exact,
  sum,
  type Quantity,
} from "../quantity.js";
import type { CallRecord, ComputeOptions, Footprint } from "../types.js";
import type { Tier } from "../tiers.js";
import { MAX_TIER_WITHOUT_PROVIDER_DISCLOSURE } from "../tiers.js";
import { resolveModelEnergy, classifyModel } from "../factors/models.js";
import { resolveGrid, resolveLand } from "../factors/grid.js";
import {
  HOST_OVERHEAD,
  PUE,
  WATER_ONSITE,
  WATER_OFFSITE,
  EMBODIED_RATIO,
} from "../factors/overhead.js";
import {
  resolvePricing,
  isModelSpecificPricing,
  CACHE_WRITE_PREMIUM,
} from "../factors/pricing.js";

/**
 * IT-side energy for one call, before datacentre overhead.
 *
 * Reasoning tokens are counted as output tokens, because that is what they are —
 * sequentially decoded and billed as output. They are separated on the record only
 * so we can show how much of a call's footprint went into thinking the customer
 * never sees (arXiv:2505.18471).
 */
export function callEnergy(call: CallRecord, opts: ComputeOptions = {}): Quantity {
  // Tier 3+ path: an actual measurement beats any estimate we could make.
  if (call.measuredWh !== undefined) {
    return quantity({
      value: call.measuredWh / 1000,
      low: (call.measuredWh / 1000) * 0.95,
      high: (call.measuredWh / 1000) * 1.05,
      unit: "kWh",
      tier: 3,
      sources: [],
    });
  }

  // A call that emitted reasoning tokens ran in the long-context regime, where the
  // same model costs materially more per token. Select that measurement if we have it.
  const reasoningRegime = (call.reasoningTokens ?? 0) > 0;
  const { factor, tier } = resolveModelEnergy(
    call.model,
    opts.defaultModelClass ?? "mid",
    reasoningRegime,
  );

  /*
   * `inputTokens` and `cachedTokens` are disjoint, not nested.
   *
   * This subtracted one from the other, on the assumption that `inputTokens` was
   * a total that `cachedTokens` was a part of. The collector has never sent it
   * that way: its Anthropic adapter maps `input_tokens + cache_creation` into
   * `inputTokens` and `cache_read_input_tokens` into `cachedTokens` — deliberately
   * separate, because a cache write does full prefill work and a cache read does
   * not. Two halves of this library disagreed about what a field meant.
   *
   * The consequence was silent and one-directional: a turn reading more from
   * cache than it sent fresh — the normal case once caching is on — clamped to
   * zero uncached input and lost the fresh tokens entirely. Measured on a live
   * conversation, 511 fresh tokens against 8,450 cached read as zero.
   */
  const cached = call.cachedTokens ?? 0;
  /*
   * A cache write costs the same energy as fresh input, because it *is* a
   * prefill — the premium a provider charges for it is a billing decision, not a
   * physical one. So it joins the input side here and is separated only in
   * `callCost`.
   *
   * Senders that do not send `cacheWriteTokens` still have their writes inside
   * `inputTokens`, so this addition is zero for them and the energy figure is
   * byte-identical to before. Splitting the field must not quietly reduce
   * anyone's measured energy.
   */
  const uncachedInput = call.inputTokens + (call.cacheWriteTokens ?? 0);
  const output = call.outputTokens + (call.reasoningTokens ?? 0);

  // Per-1k-token energy, expressed as kWh so everything downstream is in one unit.
  const perKOutput = quantity({
    value: factor.whPer1kOutput / 1000,
    low: factor.whPer1kOutputLow / 1000,
    high: factor.whPer1kOutputHigh / 1000,
    unit: "kWh",
    tier,
    sources: [factor.ref],
  });

  const outputEnergy = scaleBy(perKOutput, output / 1000);
  const inputEnergy = scaleBy(perKOutput, (uncachedInput / 1000) * factor.prefillRatio);
  const cacheEnergy = scaleBy(perKOutput, (cached / 1000) * factor.prefillRatio * factor.cacheRatio);

  const acceleratorEnergy = sum([outputEnergy, inputEnergy, cacheEnergy], "kWh");

  // Accelerator → whole server, including amortised idle and reserve capacity.
  const host = quantity({
    value: HOST_OVERHEAD.value,
    low: HOST_OVERHEAD.low,
    high: HOST_OVERHEAD.high,
    unit: "kWh",
    tier: 1,
    sources: [HOST_OVERHEAD.ref],
  });

  // Server → facility.
  const pue = quantity({
    value: PUE.value,
    low: PUE.low,
    high: PUE.high,
    unit: "kWh",
    tier: 1,
    sources: [PUE.ref],
  });

  // Overheads, not primary evidence: they widen the band but do not reclassify
  // the method. See applyOverhead in quantity.ts for why this is not `scale`.
  return applyOverhead(applyOverhead(acceleratorEnergy, host, "kWh"), pue, "kWh");
}

/** Operational carbon, plus an amortised share of hardware manufacturing. */
export function callCarbon(call: CallRecord, opts: ComputeOptions = {}): Quantity {
  const energy = callEnergy(call, opts);
  const grid = resolveGrid(call.region ?? opts.defaultRegion, opts.signal ?? "average", {
    ...(opts.allowEstimatedMarginal !== undefined
      ? { allowEstimatedMarginal: opts.allowEstimatedMarginal }
      : {}),
  });

  const intensity = quantity({
    value: grid.gco2ePerKwh,
    low: grid.low,
    high: grid.high,
    unit: "gCO2e/kWh",
    tier: 1,
    sources: [grid.ref],
  });

  const operational = scale(energy, intensity, "gCO2e");

  const embodied = quantity({
    value: operational.value * EMBODIED_RATIO.value,
    low: operational.low * EMBODIED_RATIO.low,
    high: operational.high * EMBODIED_RATIO.high,
    unit: "gCO2e",
    // Overhead, not primary evidence — see applyOverhead. Inherits the tier of
    // the operational figure it is derived from rather than pinning it to 1.
    tier: operational.tier,
    sources: [EMBODIED_RATIO.ref],
  });

  return sum([operational, embodied], "gCO2e");
}

/**
 * Water, on-site plus off-site.
 *
 * See overhead.ts for why these are separated: Google and Mistral, the only two
 * first-party sources in existence, disagree by over 170× because they draw the
 * boundary in different places. Reporting a single blended figure would hide that.
 */
export function callWater(call: CallRecord, opts: ComputeOptions = {}): Quantity {
  const energy = callEnergy(call, opts);

  // Water intensities are overheads applied to the energy figure, so they widen
  // the band without reclassifying the method that produced the energy.
  const onsite = applyOverhead(
    energy,
    quantity({
      value: WATER_ONSITE.value,
      low: WATER_ONSITE.low,
      high: WATER_ONSITE.high,
      unit: "L/kWh",
      tier: energy.tier,
      sources: [WATER_ONSITE.ref],
    }),
    "L",
  );

  const offsite = applyOverhead(
    energy,
    quantity({
      value: WATER_OFFSITE.value,
      low: WATER_OFFSITE.low,
      high: WATER_OFFSITE.high,
      unit: "L/kWh",
      tier: energy.tier,
      sources: [WATER_OFFSITE.ref],
    }),
    "L",
  );

  return sum([onsite, offsite], "L");
}

/**
 * Land use, derived from the serving zone's generation mix.
 *
 * The fourth resource, and the one that most often embarrasses a clean-energy
 * story: renewable-heavy grids frequently score *worse* here than coal-heavy ones,
 * because wind and solar occupy far more area per kWh. Great Britain sits near
 * 960 cm²/kWh against South Africa's 172, while emitting a third of the carbon.
 *
 * We publish that rather than bury it. A metric that only ever flattered the clean
 * option would not be a measurement, and the whole product rests on being the
 * thing you can check.
 *
 * The band spans direct physical footprint to footprint-plus-spacing — a ~92x
 * range for wind — which is the same boundary problem as on-site vs off-site
 * water, handled the same way.
 */
export function callLand(call: CallRecord, opts: ComputeOptions = {}): Quantity {
  const energy = callEnergy(call, opts);
  const land = resolveLand(call.region ?? opts.defaultRegion);

  return applyOverhead(
    energy,
    quantity({
      value: land.cm2PerKwh,
      low: land.low,
      high: land.high,
      unit: "cm2/kWh",
      tier: energy.tier,
      sources: [land.ref],
    }),
    "cm2",
  );
}

/** Cost. Exact when billed, estimated otherwise — and the tier says which. */
export function callCost(call: CallRecord, opts: ComputeOptions = {}): Quantity {
  if (call.billedCostUsd !== undefined) {
    return exact(call.billedCostUsd, "USD");
  }

  const cls = classifyModel(call.model, opts.defaultModelClass ?? "mid");
  const pricing = resolvePricing(call.model, cls);
  if (!pricing) {
    return quantity({ value: 0, low: 0, high: 0, unit: "USD", tier: 1, sources: [] });
  }

  // Disjoint, not nested — see the note in callEnergy. Subtracting one from the
  // other priced fresh input at zero on every cache-read turn.
  const cached = call.cachedTokens ?? 0;
  const cacheWrite = call.cacheWriteTokens ?? 0;
  const uncachedInput = call.inputTokens;
  const output = call.outputTokens + (call.reasoningTokens ?? 0);

  /*
   * Cache writes are billed at a premium, and until 2026.08.7 we priced them as
   * ordinary input.
   *
   * Anthropic charges 1.25x input on the default five-minute TTL and 2x on the
   * one-hour one. Which of the two applied is not recoverable from metadata — the
   * response says how many tokens were written, never for how long — so the
   * central estimate takes the five-minute default and the upper bound carries
   * the one-hour case. That is the honest shape: a band we can defend rather than
   * a single number we would have to pick a side on.
   *
   * `cacheWriteTokens` absent means the sender has not split them out and its
   * writes are still inside `inputTokens` at 1.0x, exactly as before. Rows already
   * stored that way cannot be corrected: once summed, nothing downstream can tell
   * a write from ordinary input. The fix is prospective by nature.
   */
  const writeCost = (m: number): number =>
    (cacheWrite / 1_000_000) * pricing.inputPer1m * m;

  const base =
    (uncachedInput / 1_000_000) * pricing.inputPer1m +
    (cached / 1_000_000) * (pricing.cachedInputPer1m ?? pricing.inputPer1m) +
    (output / 1_000_000) * pricing.outputPer1m;

  const value = base + writeCost(CACHE_WRITE_PREMIUM.default);

  /*
   * The ceiling carries the one-hour TTL, which we cannot rule out.
   *
   * Without a cache write this is identical to `value`, so the band is exactly
   * what it was before the field existed. With one, the upper bound stops being
   * "list price, undiscounted" and becomes "list price on the more expensive of
   * the two TTLs" — the genuine worst case rather than a tidier one.
   */
  const ceiling = base + writeCost(CACHE_WRITE_PREMIUM.oneHour);

  // A catalogue hit is a real published list price: the only unknown is what
  // discount this customer negotiated, so the band runs downward only. A class
  // median is a genuine estimate and gets a wide two-sided band and Tier 1.
  const specific = isModelSpecificPricing(pricing);

  return quantity({
    value,
    low: specific ? value * 0.7 : value * 0.25,
    high: specific ? ceiling : ceiling * 4,
    unit: "USD",
    tier: specific ? 2 : 1,
    sources: [pricing.ref],
  });
}

/** All four resources for one call. */
export function computeCall(call: CallRecord, opts: ComputeOptions = {}): Footprint {
  const energy = callEnergy(call, opts);
  const carbon = callCarbon(call, opts);
  const water = callWater(call, opts);
  const land = callLand(call, opts);
  const cost = callCost(call, opts);

  // The reported tier is the weakest link across the four resources, capped at what
  // provider transparency actually permits. We do not claim Tier 3 off an estimate chain.
  const measured = call.measuredWh !== undefined;
  const observed = Math.min(energy.tier, carbon.tier, water.tier, land.tier) as Tier;
  const tier = (measured ? observed : Math.min(observed, MAX_TIER_WITHOUT_PROVIDER_DISCLOSURE)) as Tier;

  return { energy, carbon, water, land, cost, tier };
}

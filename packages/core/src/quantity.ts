/**
 * The type that enforces the product's central discipline: we never emit a bare number.
 *
 * Every value we produce carries the range it could plausibly sit in, the tier of
 * evidence behind it, and the factors it was derived from. ISAE 3410 explicitly
 * tolerates estimation uncertainty *provided it is disclosed* — so disclosure is
 * built into the type system rather than left to the UI layer to remember.
 *
 * If you find yourself reaching for `.value` to display something, stop and render
 * the range instead. `formatQuantity()` below refuses to hide a wide band.
 */

import type { Tier } from "./tiers.js";
import type { FactorRef } from "./provenance.js";

export type Unit =
  | "kWh"
  | "Wh"
  | "gCO2e"
  | "kgCO2e"
  | "L"
  | "mL"
  | "USD"
  | "tokens"
  | "cm2"
  | "m2"
  | "gCO2e/kWh"
  | "L/kWh"
  | "cm2/kWh"
  | "gCO2e/unit";

export interface Quantity {
  /** Central estimate. Never render this alone — see `formatQuantity`. */
  readonly value: number;
  /** Lower bound of the plausible range. */
  readonly low: number;
  /** Upper bound of the plausible range. */
  readonly high: number;
  readonly unit: Unit;
  /** Evidence tier, 1 (weakest) to 4 (measured). See tiers.ts. */
  readonly tier: Tier;
  /** Every factor that fed this number, with source, version and retrieval date. */
  readonly sources: readonly FactorRef[];
}

export interface QuantityInit {
  value: number;
  low?: number;
  high?: number;
  unit: Unit;
  tier: Tier;
  sources?: readonly FactorRef[];
}

/**
 * Build a Quantity. If no explicit bounds are given, the band defaults to the
 * central value — which is only correct for exact quantities like token counts
 * and billed cost. Estimates must always pass explicit bounds.
 */
export function quantity(init: QuantityInit): Quantity {
  const low = init.low ?? init.value;
  const high = init.high ?? init.value;
  if (low > init.value || high < init.value) {
    throw new RangeError(
      `Quantity bounds do not bracket the value: ${low} <= ${init.value} <= ${high} (${init.unit})`,
    );
  }
  return {
    value: init.value,
    low,
    high,
    unit: init.unit,
    tier: init.tier,
    sources: init.sources ?? [],
  };
}

/** An exactly-known quantity: billed dollars, token counts. Tier 4, zero band. */
export function exact(value: number, unit: Unit, sources: readonly FactorRef[] = []): Quantity {
  return quantity({ value, unit, tier: 4, sources });
}

/**
 * Apply a multiplicative factor that itself carries uncertainty.
 * Bounds multiply through: low×low and high×high. The result inherits the
 * weaker of the two tiers, because a chain is only as good as its worst link.
 */
export function scale(q: Quantity, factor: Quantity, unit: Unit): Quantity {
  return {
    value: q.value * factor.value,
    low: q.low * factor.low,
    high: q.high * factor.high,
    unit,
    tier: Math.min(q.tier, factor.tier) as Tier,
    sources: dedupeSources([...q.sources, ...factor.sources]),
  };
}

/**
 * Multiply by an auxiliary coefficient that widens the band but does **not**
 * determine the evidence tier.
 *
 * The four-tier framework classifies the *method*: Tier 2 means per-model energy
 * from a published benchmark combined with region-specific grid intensity. A
 * generic PUE or host-overhead multiplier is a component of that method, not a
 * demotion of it.
 *
 * Treating every coefficient as tier-determining makes the whole scale
 * degenerate — PUE is a Tier 1 estimate and always will be, so a strict minimum
 * pins every figure at Tier 1 forever and the tier stops carrying information.
 * That is exactly what the first rendered report showed: four uniform bars.
 *
 * Tier-determining factors are the primary evidence — model energy and grid
 * intensity — and those still go through `scale`.
 */
export function applyOverhead(q: Quantity, factor: Quantity, unit: Unit): Quantity {
  return {
    value: q.value * factor.value,
    low: q.low * factor.low,
    high: q.high * factor.high,
    unit,
    tier: q.tier,
    sources: dedupeSources([...q.sources, ...factor.sources]),
  };
}

/** Multiply by an exactly-known scalar (a token count, a headcount). Band scales with it. */
export function scaleBy(q: Quantity, k: number, unit: Unit = q.unit): Quantity {
  return { ...q, value: q.value * k, low: q.low * k, high: q.high * k, unit };
}

/** Sum quantities of the same unit. Bounds add — deliberately conservative. */
export function sum(quantities: readonly Quantity[], unit: Unit): Quantity {
  if (quantities.length === 0) {
    return quantity({ value: 0, unit, tier: 4 });
  }
  const mismatched = quantities.find((q) => q.unit !== unit);
  if (mismatched) {
    throw new TypeError(`Cannot sum ${mismatched.unit} into ${unit}`);
  }
  return {
    value: quantities.reduce((a, q) => a + q.value, 0),
    low: quantities.reduce((a, q) => a + q.low, 0),
    high: quantities.reduce((a, q) => a + q.high, 0),
    unit,
    tier: quantities.reduce<Tier>((worst, q) => (q.tier < worst ? q.tier : worst), 4),
    sources: dedupeSources(quantities.flatMap((q) => [...q.sources])),
  };
}

/** Relative width of the uncertainty band, as a fraction of the central value. */
export function bandWidth(q: Quantity): number {
  if (q.value === 0) return 0;
  return (q.high - q.low) / q.value;
}

/**
 * True when the band is too wide to responsibly show a single figure.
 *
 * The UI contract: when this returns true, render "0.8–3.4 gCO2e", never "1.9 gCO2e".
 * Default threshold of 0.5 (band spans more than half the central value) is a
 * judgement call, documented in METHODOLOGY.md and overridable per surface.
 */
export function isWideBand(q: Quantity, threshold = 0.5): boolean {
  return bandWidth(q) > threshold;
}

export interface FormatOptions {
  /** Significant figures for display. */
  precision?: number;
  /** Band width above which a range is shown instead of a point value. */
  rangeThreshold?: number;
}

/**
 * Render a Quantity for humans, showing a range whenever the band is wide.
 * This is the function the UI should call. It is deliberately the path of
 * least resistance so nobody has to remember the rule.
 */
export function formatQuantity(q: Quantity, opts: FormatOptions = {}): string {
  const { precision = 3, rangeThreshold = 0.5 } = opts;
  const fmt = (n: number) => Number(n.toPrecision(precision)).toLocaleString("en-US");
  if (isWideBand(q, rangeThreshold)) {
    return `${fmt(q.low)}–${fmt(q.high)} ${q.unit}`;
  }
  return `${fmt(q.value)} ${q.unit}`;
}

function dedupeSources(refs: readonly FactorRef[]): readonly FactorRef[] {
  const seen = new Map<string, FactorRef>();
  for (const ref of refs) {
    seen.set(`${ref.id}@${ref.version}`, ref);
  }
  return [...seen.values()];
}

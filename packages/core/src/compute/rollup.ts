/**
 * Aggregation by attribution dimension.
 *
 * The `customer` dimension is the one that matters commercially. Cost tools
 * attribute to teams and cost centres because that is what a FinOps buyer asks
 * for; carbon platforms attribute to legal entities because that is what a filing
 * needs. Neither can answer "what did *this customer's* usage of *this feature*
 * emit", which is the number our customer needs in order to hand their own
 * customers an AI footprint. That is the wedge, and it has to be in the schema
 * from the start because retrofitting attribution is painful.
 *
 * Everything here rolls up **traces**, not calls. A trace is one business
 * outcome, and outcomes are the denominator of the only metric we lead with.
 */

import { sum, quantity, type Quantity } from "../quantity.js";
import type { ComputeOptions, Footprint, TraceRecord } from "../types.js";
import type { Tier } from "../tiers.js";
import { computeTrace, type TraceFootprint } from "./trace.js";

export type Dimension = "team" | "feature" | "customer" | "model" | "provider" | "region";

/**
 * Dimensions that legitimately vary *within* a trace and must be aggregated at
 * call level.
 *
 * A support agent that runs Haiku for four intermediate turns and Sonnet for the
 * final answer has no single "model". Rolling that up at trace level yields
 * `(mixed)` for every row and a breakdown that tells you nothing — which is
 * exactly what the first rendered report did.
 *
 * Team, feature and customer are also per-call in the schema, but are normally
 * constant across a trace, so they stay trace-level to keep outcome counts and
 * SCI meaningful.
 */
export const CALL_LEVEL_DIMENSIONS: ReadonlySet<Dimension> = new Set([
  "model",
  "provider",
  "region",
  // `feature` was trace-level until the first real capture proved otherwise.
  // SiteBeacon's recognition report spans two features in one trace — 25 audit
  // calls plus one Get-Known asset call — and rolled up per trace it collapsed to
  // "(mixed)", which answers nothing. "Which feature costs what" is inherently a
  // per-call question once a trace can span features.
  //
  // Where a feature IS constant across a trace, the numbers are identical; only
  // the count column changes from traces to calls.
  "feature",
]);

export type RollupLevel = "trace" | "call";

/** Whether a set of dimensions should be aggregated per call rather than per trace. */
export function levelFor(dims: readonly Dimension[]): RollupLevel {
  return dims.some((d) => CALL_LEVEL_DIMENSIONS.has(d)) ? "call" : "trace";
}

/**
 * Marker for a trace whose calls disagree on a dimension — an agent that spans
 * two features, say. Surfaced rather than silently resolved, because a report
 * that quietly picks the first value is a report that misattributes.
 */
export const MIXED = "(mixed)";
export const UNATTRIBUTED = "(unattributed)";

export interface TierDistribution {
  readonly counts: Readonly<Record<Tier, number>>;
  /** Share of traces at each tier. */
  readonly shares: Readonly<Record<Tier, number>>;
  /**
   * Share of *carbon* at each tier, which is the number that actually matters.
   * A report can be 90% Tier 2 by trace count while 90% of its emissions sit at
   * Tier 1, and those are very different documents to put in front of an auditor.
   */
  readonly carbonShares: Readonly<Record<Tier, number>>;
  readonly weakest: Tier;
}

export interface RollupGroup {
  readonly key: Readonly<Record<string, string>>;
  readonly traces: number;
  readonly calls: number;
  readonly tokens: number;
  /** Tokens billed but never seen by the end user: reasoning plus intermediate steps. */
  readonly invisibleTokens: number;
  readonly outcomes: number;
  readonly footprint: Footprint;
  /** gCO2e per outcome. Undefined when no outcomes were recorded. */
  readonly sci?: Quantity;
  /** Distribution of the composite tier — the weakest link across all four resources. */
  readonly tierMix: TierDistribution;
  /**
   * Distribution per resource, which is where the useful signal is: the gap
   * between the energy row and the carbon row shows exactly which input is
   * holding the report back.
   */
  readonly tierByResource: Readonly<Record<Resource, TierDistribution>>;
}

const EMPTY_TIER_COUNTS: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

export type Resource = "energy" | "carbon" | "water" | "land" | "cost";

/**
 * Tier distribution over an arbitrary resource, not just the composite.
 *
 * The composite tier is the weakest link across all four resources, which means
 * in practice it is pinned by whichever factor is worst — currently the grid,
 * since it is an annual country average. Reporting only the composite therefore
 * hides where the constraint actually binds: model energy can sit at Tier 2 for
 * a benchmarked model while the carbon figure derived from it is still Tier 1.
 *
 * Showing energy and carbon side by side makes that visible, which is both more
 * honest and more useful — it tells a reader exactly which input to improve.
 */
function tierDistribution(
  footprints: readonly TraceFootprint[],
  pick: (f: TraceFootprint) => Tier = (f) => f.tier,
): TierDistribution {
  const counts: Record<Tier, number> = { ...EMPTY_TIER_COUNTS };
  const carbon: Record<Tier, number> = { ...EMPTY_TIER_COUNTS };
  let totalCarbon = 0;

  for (const f of footprints) {
    const tier = pick(f);
    counts[tier] += 1;
    carbon[tier] += f.carbon.value;
    totalCarbon += f.carbon.value;
  }

  const n = footprints.length || 1;
  const c = totalCarbon || 1;
  const shares = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Tier, number>;
  const carbonShares = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Tier, number>;
  for (const t of [1, 2, 3, 4] as const) {
    shares[t] = counts[t] / n;
    carbonShares[t] = carbon[t] / c;
  }

  const present = ([1, 2, 3, 4] as const).filter((t) => counts[t] > 0);
  return { counts, shares, carbonShares, weakest: present[0] ?? 4 };
}

/** Read a dimension off a trace, flagging disagreement rather than resolving it. */
function dimensionValue(trace: TraceRecord, dim: Dimension): string {
  const values = new Set<string>();
  for (const call of trace.calls) {
    const v =
      dim === "team"
        ? call.team
        : dim === "feature"
          ? call.feature
          : dim === "customer"
            ? call.customer
            : dim === "model"
              ? call.model
              : dim === "provider"
                ? call.provider
                : call.region;
    values.add(v ?? UNATTRIBUTED);
  }
  if (values.size === 1) return [...values][0]!;
  return MIXED;
}

export type Period = "day" | "month" | "quarter" | "year";

/** Bucket an ISO timestamp. Uses UTC throughout — a report must not shift with the reader. */
export function periodKey(iso: string, period: Period): string {
  const [datePart = ""] = iso.split("T");
  const [y = "", m = "", d = ""] = datePart.split("-");
  switch (period) {
    case "year":
      return y;
    case "quarter":
      return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
    case "month":
      return `${y}-${m}`;
    case "day":
      return `${y}-${m}-${d}`;
  }
}

export interface RollupOptions extends ComputeOptions {
  /** Dimensions to group by, in order. Empty means one total group. */
  readonly by?: readonly Dimension[];
  /** Additionally bucket by time. */
  readonly period?: Period;
  /**
   * Aggregate per call rather than per trace. Defaults from the dimensions via
   * `levelFor` — you rarely want to set this by hand.
   *
   * Call-level groups report no outcomes and therefore no SCI: an outcome belongs
   * to a whole trace and cannot be split across the models that produced it.
   */
  readonly level?: RollupLevel;
}

function groupKey(
  trace: TraceRecord,
  dims: readonly Dimension[],
  period: Period | undefined,
): { serial: string; key: Record<string, string> } {
  const key: Record<string, string> = {};
  for (const dim of dims) key[dim] = dimensionValue(trace, dim);
  if (period) {
    const first = trace.calls[0];
    key["period"] = first ? periodKey(first.timestamp, period) : UNATTRIBUTED;
  }
  return { serial: JSON.stringify(key), key };
}

function buildGroup(
  key: Record<string, string>,
  footprints: readonly TraceFootprint[],
): RollupGroup {
  const outcomes = footprints.reduce((a, f) => a + f.outcomeCount, 0);
  const carbon = sum(
    footprints.map((f) => f.carbon),
    "gCO2e",
  );

  const group: RollupGroup = {
    key,
    traces: footprints.length,
    calls: footprints.reduce((a, f) => a + f.callCount, 0),
    tokens: footprints.reduce((a, f) => a + f.totalTokens, 0),
    invisibleTokens: footprints.reduce((a, f) => a + f.invisibleTokens, 0),
    outcomes,
    footprint: {
      energy: sum(
        footprints.map((f) => f.energy),
        "kWh",
      ),
      carbon,
      water: sum(
        footprints.map((f) => f.water),
        "L",
      ),
      land: sum(
        footprints.map((f) => f.land),
        "cm2",
      ),
      cost: sum(
        footprints.map((f) => f.cost),
        "USD",
      ),
      tier: footprints.reduce<Tier>((worst, f) => (f.tier < worst ? f.tier : worst), 4),
    },
    tierMix: tierDistribution(footprints),
    tierByResource: {
      energy: tierDistribution(footprints, (f) => f.energy.tier),
      carbon: tierDistribution(footprints, (f) => f.carbon.tier),
      water: tierDistribution(footprints, (f) => f.water.tier),
      land: tierDistribution(footprints, (f) => f.land.tier),
      cost: tierDistribution(footprints, (f) => f.cost.tier),
    },
    ...(outcomes > 0
      ? {
          sci: quantity({
            value: carbon.value / outcomes,
            low: carbon.low / outcomes,
            high: carbon.high / outcomes,
            unit: "gCO2e/unit",
            tier: carbon.tier,
            sources: carbon.sources,
          }),
        }
      : {}),
  };

  return group;
}

/**
 * Roll traces up by the requested dimensions, heaviest emitter first.
 *
 * Ordering by carbon rather than alphabetically is deliberate: the first row of
 * any breakdown should be the thing worth acting on.
 */
/**
 * Wrap a single call as a one-call trace so call-level and trace-level rollups
 * share one aggregation path. `outcomeCount: 0` is the honest value — an outcome
 * belongs to the whole trace, not to any one call inside it.
 */
function callAsTrace(trace: TraceRecord, index: number): TraceRecord {
  return { traceId: `${trace.traceId}#${index}`, calls: [trace.calls[index]!], outcomeCount: 0 };
}

export function rollup(
  traces: readonly TraceRecord[],
  opts: RollupOptions = {},
): readonly RollupGroup[] {
  const dims = opts.by ?? [];
  const level = opts.level ?? levelFor(dims);
  const buckets = new Map<string, { key: Record<string, string>; items: TraceFootprint[] }>();

  const units: TraceRecord[] =
    level === "call"
      ? traces.flatMap((t) => t.calls.map((_, i) => callAsTrace(t, i)))
      : [...traces];

  for (const unit of units) {
    const { serial, key } = groupKey(unit, dims, opts.period);
    const footprint = computeTrace(unit, opts);
    const bucket = buckets.get(serial);
    if (bucket) bucket.items.push(footprint);
    else buckets.set(serial, { key, items: [footprint] });
  }

  return [...buckets.values()]
    .map(({ key, items }) => buildGroup(key, items))
    .sort((a, b) => b.footprint.carbon.value - a.footprint.carbon.value);
}

/** Everything as one group — the report total. */
export function rollupTotal(traces: readonly TraceRecord[], opts: ComputeOptions = {}): RollupGroup {
  const [total] = rollup(traces, opts);
  return total ?? buildGroup({}, []);
}

/**
 * Efficiency over time: gCO2e per outcome, per period.
 *
 * This is the headline metric rather than an absolute total, because an absolute
 * total is a shame metric — it rises as the business succeeds, so the tool that
 * displays it gets uninstalled. Efficiency improves when you do the right things
 * and stays honest as you grow, which is also what keeps it Jevons-proof.
 */
export function efficiencyByPeriod(
  traces: readonly TraceRecord[],
  period: Period = "month",
  opts: ComputeOptions = {},
): readonly { period: string; gco2ePerOutcome: Quantity; outcomes: number; traces: number }[] {
  return rollup(traces, { ...opts, period })
    .filter((g) => g.sci !== undefined)
    .map((g) => ({
      period: g.key["period"] ?? UNATTRIBUTED,
      gco2ePerOutcome: g.sci!,
      outcomes: g.outcomes,
      traces: g.traces,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

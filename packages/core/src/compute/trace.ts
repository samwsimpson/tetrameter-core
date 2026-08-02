/**
 * Trace-level computation — the unit the rest of the market gets wrong.
 *
 * Every competitor measures per query. That unit is obsolete. The Green Software
 * Foundation calls the effect "the agentic multiplier": one business outcome now
 * consumes "hundreds, sometimes thousands of times more" tokens than a chat turn
 * once you stack planning loops, tool calls, reflection, retries, multi-agent
 * debate, and context that compounds every turn. And crucially:
 *
 *     "Higher token usage does not translate into higher accuracy."
 *
 * That sentence is the entire product thesis. It means the waste is provable.
 *
 * So we aggregate to the trace, express intensity per *outcome* rather than per
 * token, and never make an absolute total the headline number.
 */

import { sum, quantity, type Quantity } from "../quantity.js";
import type { CallRecord, ComputeOptions, Footprint, TraceRecord } from "../types.js";
import type { Tier } from "../tiers.js";
import { computeCall } from "./call.js";

export interface TraceFootprint extends Footprint {
  readonly traceId: string;
  readonly callCount: number;
  readonly totalTokens: number;
  /** Tokens the customer never sees: reasoning tokens plus intermediate steps. */
  readonly invisibleTokens: number;
  /** Share of total tokens that were invisible. A waste signal in its own right. */
  readonly invisibleShare: number;
  readonly outcome?: string;
  readonly outcomeCount: number;
}

/** Roll a trace's calls up into one footprint. */
export function computeTrace(trace: TraceRecord, opts: ComputeOptions = {}): TraceFootprint {
  const perCall = trace.calls.map((c) => computeCall(c, opts));

  const totalTokens = trace.calls.reduce(
    (a, c) => a + c.inputTokens + c.outputTokens + (c.reasoningTokens ?? 0),
    0,
  );
  const reasoningTokens = trace.calls.reduce((a, c) => a + (c.reasoningTokens ?? 0), 0);

  // Every call except the last produces output the end user never sees directly —
  // it is intermediate agent scaffolding. Combined with reasoning tokens, that is
  // the "invisible" share the customer is billed for but cannot inspect.
  const intermediateOutput = trace.calls
    .slice(0, -1)
    .reduce((a, c) => a + c.outputTokens, 0);
  const invisibleTokens = reasoningTokens + intermediateOutput;

  return {
    traceId: trace.traceId,
    callCount: trace.calls.length,
    totalTokens,
    invisibleTokens,
    invisibleShare: totalTokens === 0 ? 0 : invisibleTokens / totalTokens,
    ...(trace.outcome !== undefined ? { outcome: trace.outcome } : {}),
    /*
     * A trace where every call failed produced no outcome.
     *
     * The energy still counts — it was burned, and a failed attempt is real
     * consumption. But counting it as an achieved outcome inflates the
     * denominator of the one metric we lead with, which makes efficiency look
     * better precisely when a customer is burning tokens on work that did not
     * land. That is the flattering direction, and this library exists to not go
     * that way.
     *
     * Every call, not any: a trace that failed once and succeeded on retry did
     * produce its outcome, and the retry is waste the numerator already carries.
     *
     * An explicit `outcomeCount` still wins. A caller who says a trace produced
     * three outcomes knows something the error field does not express.
     */
    outcomeCount:
      trace.outcomeCount ??
      (trace.calls.length > 0 && trace.calls.every((c) => c.error !== undefined) ? 0 : 1),
    energy: sum(perCall.map((f) => f.energy), "kWh"),
    carbon: sum(perCall.map((f) => f.carbon), "gCO2e"),
    water: sum(perCall.map((f) => f.water), "L"),
    land: sum(perCall.map((f) => f.land), "cm2"),
    cost: sum(perCall.map((f) => f.cost), "USD"),
    tier: perCall.reduce<Tier>((worst, f) => (f.tier < worst ? f.tier : worst), 4),
  };
}

/**
 * Group loose calls into traces by traceId. Calls without one become single-call
 * traces rather than being dropped — incomplete instrumentation should degrade
 * the number, not silently lose it.
 */
export function groupIntoTraces(calls: readonly CallRecord[]): TraceRecord[] {
  const grouped = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const key = call.traceId ?? `single:${call.id}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(call);
    else grouped.set(key, [call]);
  }
  return [...grouped.entries()].map(([traceId, list]) => ({
    traceId,
    calls: list.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  }));
}

/**
 * Software Carbon Intensity, per the GSF SCI specification (ISO/IEC 21031:2024)
 * and its SCI for AI extension, ratified Q4 2025.
 *
 *     SCI = ((E × I) + M) / R
 *
 * where E is energy, I is grid intensity, M is embodied emissions, and R is the
 * functional unit. `callCarbon` already folds E×I and M together, so this reduces
 * to dividing total carbon by the number of outcomes.
 *
 * The choice of R is the substantive decision, not the arithmetic. R should be a
 * *business outcome* — a resolved ticket, a processed document — not a token.
 * Per-token intensity improves automatically as models get more efficient, which
 * flatters you while total consumption grows. Per-outcome intensity is the one
 * that stays honest under Jevons.
 */
export function sci(footprint: TraceFootprint | Footprint, functionalUnits: number): Quantity {
  if (functionalUnits <= 0) {
    throw new RangeError("SCI requires a positive functional unit count (R).");
  }
  return quantity({
    value: footprint.carbon.value / functionalUnits,
    low: footprint.carbon.low / functionalUnits,
    high: footprint.carbon.high / functionalUnits,
    unit: "gCO2e/unit",
    tier: footprint.carbon.tier,
    sources: footprint.carbon.sources,
  });
}

export interface EfficiencyPoint {
  readonly period: string;
  readonly gco2ePerOutcome: Quantity;
  readonly outcomes: number;
}

/**
 * The headline metric: work done per gram, over time.
 *
 * We report this rather than absolute totals because an absolute total is a shame
 * metric — it rises as the business succeeds, so the tool that displays it gets
 * uninstalled. Efficiency improves as you do the right things and stays honest as
 * you grow. Absolute totals remain available and auditable; they are simply never
 * the hero number.
 */
export function efficiencyTrend(points: readonly EfficiencyPoint[]): {
  readonly points: readonly EfficiencyPoint[];
  /** Improvement factor from first to last period. 4.2 means "4.2× more work per gram". */
  readonly improvementFactor: number | undefined;
} {
  const sorted = [...points].sort((a, b) => a.period.localeCompare(b.period));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let improvementFactor: number | undefined;
  if (first && last && last.gco2ePerOutcome.value > 0 && sorted.length > 1) {
    improvementFactor = first.gco2ePerOutcome.value / last.gco2ePerOutcome.value;
  }

  return { points: sorted, improvementFactor };
}

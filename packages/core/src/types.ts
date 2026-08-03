/**
 * The wire model. Note what is absent: no prompt text, no completion text, no
 * message content of any kind. Carbon and cost need only metadata, so metadata
 * is all we accept — enforced by the type, not by policy.
 */

import type { Quantity } from "./quantity.js";
import type { Tier } from "./tiers.js";

/**
 * Coarse capability class, used for Tier 1 estimation when the specific model
 * is unknown or absent from the benchmark set.
 */
export type ModelClass = "small" | "mid" | "large" | "reasoning";

/** One LLM call. The atomic unit of ingest — but not the unit of reporting. */
export interface CallRecord {
  /** Stable id for this call. */
  readonly id: string;
  /** Trace this call belongs to. Calls without one are treated as single-call traces. */
  readonly traceId?: string;
  /** Parent span, for nested agent steps. */
  readonly parentId?: string;
  /** ISO 8601 timestamp of the request. */
  readonly timestamp: string;

  readonly provider: string;
  /** Provider's model identifier, e.g. "claude-sonnet-5". */
  readonly model: string;
  /** Grid zone the inference ran in, if known, e.g. "US-CAISO". */
  readonly region?: string;

  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens served from cache — billed differently and far cheaper in energy. */
  readonly cachedTokens?: number;
  /**
   * Tokens written *into* the cache on this call, where the sender separates
   * them. Disjoint from both `inputTokens` and `cachedTokens`.
   *
   * A write is not ordinary input. It does the full prefill work — so it costs
   * the same energy as fresh input — and providers bill it at a premium:
   * Anthropic charges 1.25x input on the default five-minute TTL and 2x on the
   * one-hour one. Folded into `inputTokens` at 1.0x, as every sender did before
   * this field existed, a write turn reads cheaper than it was billed while the
   * read turns that follow are exact. A measured caching saving therefore comes
   * out larger than it really was — an error in the flattering direction, under
   * the one number this product publishes a case study about.
   *
   * Absent means the sender does not separate it, and its writes are still inside
   * `inputTokens` at 1.0x. That is the old behaviour, unchanged, and it cannot be
   * corrected after the fact: once summed, nothing downstream can tell a write
   * from ordinary input.
   */
  readonly cacheWriteTokens?: number;
  /**
   * Reasoning tokens, where the provider reports them. These are the tokens you
   * are billed for but cannot inspect (arXiv:2505.18471), and on reasoning models
   * they dominate the footprint.
   */
  readonly reasoningTokens?: number;

  /** Wall-clock duration in milliseconds, if captured. */
  readonly durationMs?: number;
  /** Cost in USD as billed, when known. Exact beats estimated. */
  readonly billedCostUsd?: number;

  /** Attribution dimensions. `customer` is the one nobody else carries. */
  readonly team?: string;
  readonly feature?: string;
  readonly customer?: string;

  /**
   * Directly measured energy for this call, in Wh. Present only for self-hosted
   * inference or a provider that discloses it — and the only route to Tier 3+.
   */
  readonly measuredWh?: number;

  /**
   * Set when the call failed.
   *
   * The tokens still count: a request the provider processed and then rejected
   * burned real energy, and dropping failures would report a smaller footprint
   * than was caused. What changes is the *denominator* — a trace whose every
   * call failed produced no outcome, and crediting it with one makes efficiency
   * look better exactly when work is being wasted.
   *
   * The collector has carried this since the beginning; the engine could not see
   * it, which is how failed traces came to be counted as successes. Free text,
   * never content — a status line or provider code, never a response body.
   */
  readonly error?: string;
}

/** A task: every call an agent made to produce one business outcome. */
export interface TraceRecord {
  readonly traceId: string;
  readonly calls: readonly CallRecord[];
  /**
   * What this trace accomplished, if known — "ticket resolved", "document processed".
   * This is the functional unit the SCI is expressed per, and the denominator of the
   * efficiency metric we lead with instead of absolute totals.
   */
  readonly outcome?: string;
  readonly outcomeCount?: number;
}

/**
 * The four resources, plus cost.
 *
 * The four measured resources are **energy, carbon, water and land** — the physical
 * footprint. Cost is not a fifth resource; it is the same consumption priced by the
 * market, which is the founding thesis restated: for AI, cost and carbon are the
 * same variable because both scale with compute.
 *
 * That distinction matters commercially as well as conceptually. Four resources are
 * what nobody else measures; cost is what gets us in the door.
 */
export interface Footprint {
  readonly energy: Quantity;
  readonly carbon: Quantity;
  readonly water: Quantity;
  readonly land: Quantity;
  /** Not a resource — the same consumption, priced. */
  readonly cost: Quantity;
  /** Weakest tier across the four resources and cost. What the report must disclose. */
  readonly tier: Tier;
}

/**
 * Which grid signal to use.
 *
 * `average` (location-based) is what GHG Protocol requires for an inventory.
 * `marginal` is what is physically true for a *reduction claim* — the emissions
 * of the generators that actually respond to a change in load.
 *
 * These are not interchangeable. Published work shows the same intervention reading
 * 18% savings on the average signal and 11% on marginal, and turning negative when
 * measured with the other one. Using the wrong signal is the single most common way
 * to produce a defensible-looking number that is wrong.
 */
export type GridSignal = "average" | "marginal";

export interface ComputeOptions {
  /** Defaults to "average" — correct for inventory reporting. */
  readonly signal?: GridSignal;
  /** Fallback region when a call carries none. */
  readonly defaultRegion?: string;
  /** Fallback class when the model is not in the benchmark set. */
  readonly defaultModelClass?: ModelClass;
  /**
   * Accept a fossil-mix-inferred marginal factor where no measured MOER exists.
   *
   * Off by default. Every marginal figure in the static table is currently an
   * inference, so `signal: "marginal"` throws without this. That is deliberate
   * friction: a reduction claim built on an inferred marginal is defensible only
   * if you know that is what you have and say so.
   */
  readonly allowEstimatedMarginal?: boolean;
}

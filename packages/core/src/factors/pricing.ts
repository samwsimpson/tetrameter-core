/**
 * Token pricing, for the cost side of the ledger.
 *
 * Cost is the only one of the four resources that can be exactly known, because
 * the provider bills it. The rule is therefore: if `billedCostUsd` is present on
 * the call, use it and mark it Tier 4. This table is only for estimating when it
 * is absent.
 *
 * Backed by the LiteLLM price catalogue (MIT) — roughly 2,100 chat models across
 * every major provider, including Bedrock, Azure, Vertex and the aggregators,
 * whose prices differ from the direct-API prices for the same model.
 *
 * ── Why this matters more than it looks ─────────────────────────────────────
 *
 * Cost is the entry motion: engineering signs first and sustainability renews.
 * A carbon figure with a defensible band next to a dollar figure pulled from a
 * guess is a product that loses the first meeting. The bootstrap stubs were
 * materially wrong — they priced the large class at $15/$75 per 1M when Claude
 * Opus 5 actually bills $5/$25 — which would have overstated spend threefold and
 * every "savings" figure derived from it.
 */

import type { FactorRef } from "../provenance.js";
import { indexBothSpellings, normalizeModelId } from "./normalize.js";
import {
  PRICING_ROWS,
  PRICING_CLASS_MEDIAN,
  PRICING_SOURCE,
  PRICING_SOURCE_URL,
  PRICING_RETRIEVED,
  type PricingTuple,
} from "./pricing-data.js";

export interface PricingFactor {
  readonly id: string;
  /** USD per 1M input tokens. */
  readonly inputPer1m: number;
  /** USD per 1M output tokens. */
  readonly outputPer1m: number;
  /** USD per 1M cached input tokens, where the provider discounts them. */
  readonly cachedInputPer1m?: number;
  /** Whether the provider declares extended reasoning support. */
  readonly supportsReasoning: boolean;
  readonly ref: FactorRef;
}

const VERSION = "2026.08.0";

/**
 * What a provider charges to *write* a prompt-cache entry, as a multiple of its
 * ordinary input price.
 *
 * Anthropic publishes 1.25x on the default five-minute TTL and 2x on the
 * one-hour one. OpenAI does not charge a write premium at all, so this
 * overstates for OpenAI-cached traffic — deliberately, and in the direction that
 * does not flatter us. When a second provider's premium is worth modelling
 * separately this becomes a per-provider lookup; one number with its ceiling
 * disclosed beats a table with one honest row.
 *
 * The TTL is not recoverable from a response: it reports how many tokens were
 * written, never for how long. So `default` is the central estimate and
 * `oneHour` is the ceiling, and the gap between them is carried in the band
 * rather than resolved by picking one.
 */
export const CACHE_WRITE_PREMIUM = {
  /** Anthropic's five-minute TTL, which is the default and the common case. */
  default: 1.25,
  /** Anthropic's one-hour TTL. Indistinguishable from the default in metadata. */
  oneHour: 2.0,
} as const;

function priceRef(id: string, detail: string): FactorRef {
  return {
    id: `pricing.${id}`,
    kind: "pricing",
    version: VERSION,
    source: `${PRICING_SOURCE} — ${detail}`,
    url: PRICING_SOURCE_URL,
    retrieved: PRICING_RETRIEVED,
    note:
      "Public list price at retrieval date. Negotiated enterprise rates, committed-use " +
      "discounts and batch pricing are not reflected, which is why estimated cost carries a " +
      "downward band. Prefer billedCostUsd on the call record — it is exact.",
  };
}

function toFactor(row: PricingTuple): PricingFactor {
  const [id, inputPer1m, outputPer1m, cachedPer1m, reasoning] = row;
  return {
    id,
    inputPer1m,
    outputPer1m,
    ...(cachedPer1m > 0 ? { cachedInputPer1m: cachedPer1m } : {}),
    supportsReasoning: reasoning === 1,
    ref: priceRef(id, id),
  };
}

function buildPricing(): Map<string, PricingFactor> {
  const map = new Map<string, PricingFactor>();
  // Indexed under both spellings: the collector normalises "4.5" to "4-5", but
  // this catalogue stores some ids with dots (gemini/gemini-2.5-flash). Without
  // both keys a normalised id missed and fell back to a class median, silently.
  for (const row of PRICING_ROWS) indexBothSpellings(map, row[0], toFactor(row));
  return map;
}

/** Per-model pricing, keyed by lowercase model id as the catalogue names it. */
export const PRICING: ReadonlyMap<string, PricingFactor> = buildPricing();

export type PricingClass = "small" | "mid" | "large" | "reasoning";

const CLASS_FACTORS: Readonly<Record<PricingClass, PricingFactor>> = Object.freeze(
  Object.fromEntries(
    (["small", "mid", "large", "reasoning"] as const).map((cls) => {
      const m = PRICING_CLASS_MEDIAN[cls];
      return [
        cls,
        {
          id: `class.${cls}`,
          inputPer1m: m.inputPer1m,
          outputPer1m: m.outputPer1m,
          cachedInputPer1m: m.cachedPer1m,
          supportsReasoning: cls === "reasoning",
          ref: priceRef(`class.${cls}`, `median across catalogue, ${cls} class`),
        } satisfies PricingFactor,
      ];
    }),
  ) as Record<PricingClass, PricingFactor>,
);

/**
 * Resolve pricing for a model.
 *
 * Tries the exact catalogue key, then the name with any provider prefix stripped
 * (`azure_ai/deepseek-r1` → `deepseek-r1`), then falls back to the class median.
 *
 * Prefix stripping is one level only and deliberately not fuzzy. A near-miss that
 * silently prices Opus as Haiku is far worse than an honest class fallback, and
 * fuzzy matching on model names is exactly how that happens.
 */
export function resolvePricing(model: string, cls: string): PricingFactor | undefined {
  const raw = model.toLowerCase();

  for (const key of [raw, normalizeModelId(raw)]) {
    const exact = PRICING.get(key);
    if (exact) return exact;

    const slash = key.indexOf("/");
    if (slash > 0) {
      const stripped = PRICING.get(key.slice(slash + 1));
      if (stripped) return stripped;
    }
  }

  return CLASS_FACTORS[cls as PricingClass] ?? CLASS_FACTORS.mid;
}

/** True when the catalogue was the source, rather than a class median. */
export function isModelSpecificPricing(factor: PricingFactor): boolean {
  return !factor.id.startsWith("class.");
}

export { PRICING_ROWS, PRICING_CLASS_MEDIAN, PRICING_SOURCE, PRICING_RETRIEVED };

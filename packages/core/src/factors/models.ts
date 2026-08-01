/**
 * Per-model inference energy, from the ML.ENERGY Benchmark.
 *
 * Superseded the bootstrap class averages in factor set 2026.08.0. See
 * `RESTATEMENTS` in ./index.ts for the materiality of that change.
 *
 * ── What changed and why it matters ──────────────────────────────────────────
 *
 * The bootstrap asserted class averages anchored loosely to published figures.
 * These are measured: 328 serving configurations across 24 models on H100 and
 * B200 hardware, from the benchmark EcoLogits itself moved to in 2026
 * (arXiv:2505.06371). Three things fell out of the real data that the bootstrap
 * had wrong:
 *
 *   1. Serving configuration dominates. The same model varies 4–35x per token
 *      with batch size and parallelism. An API customer cannot see any of that,
 *      so the measured spread becomes our uncertainty band rather than being
 *      averaged away.
 *
 *   2. Reasoning models are not primarily expensive per token — they are
 *      expensive because they emit 10–20x more tokens. The bootstrap put a 4.5x
 *      per-token penalty on the reasoning class; the real premium for a given
 *      model is closer to 2–3x, and it comes from long-context attention rather
 *      than from "being a reasoning model". Token count carries the rest, and we
 *      already model that separately.
 *
 *   3. Prefill is already amortised in. The source divides total request energy
 *      by output tokens, so a typical prompt's prefill cost is baked into the
 *      per-token figure. `prefillRatio` therefore drops sharply — it now covers
 *      only input beyond a typical prompt, not baseline prefill.
 *
 * ── What is still Tier 1 ─────────────────────────────────────────────────────
 *
 * Every model in the benchmark is open-weight. No commercial API model (Claude,
 * GPT, Gemini) appears, because nobody publishes their architecture, parameter
 * count or serving configuration. Calls to those models resolve to a class
 * average and stay Tier 1. That is the honest ceiling, and pretending otherwise
 * would be the exact failure this library exists to prevent.
 */

import { indexBothSpellings, normalizeModelId } from "./normalize.js";
import type { FactorRef } from "../provenance.js";
import type { ModelClass } from "../types.js";
import {
  MLENERGY_ROWS,
  MLENERGY_CLASS,
  MLENERGY_SNAPSHOT,
  MLENERGY_RETRIEVED,
  type EnergyRegime,
} from "./mlenergy.js";

export interface ModelEnergyFactor {
  readonly id: string;
  /** Wh per 1,000 output (decode) tokens — central estimate. */
  readonly whPer1kOutput: number;
  readonly whPer1kOutputLow: number;
  readonly whPer1kOutputHigh: number;
  /**
   * Input-token energy as a fraction of output-token energy.
   * Small, because baseline prefill is already amortised into the source figure.
   */
  readonly prefillRatio: number;
  /** Cached-token energy as a fraction of a normal input token. */
  readonly cacheRatio: number;
  readonly class: ModelClass;
  readonly ref: FactorRef;
}

const VERSION = "2026.08.0";

/**
 * Applies to input tokens beyond a typical prompt only. The ML.ENERGY figure is
 * request energy over output tokens, so ordinary prefill is already counted;
 * a larger ratio here would double-count it.
 */
const PREFILL_RATIO = 0.05;
const CACHE_RATIO = 0.02;

function mlRef(id: string, detail: string, configs: number): FactorRef {
  return {
    id,
    kind: "model-energy",
    version: VERSION,
    source: `ML.ENERGY Benchmark, snapshot ${MLENERGY_SNAPSHOT} — ${detail}, ${configs} serving configurations`,
    url: "https://ml.energy/leaderboard",
    retrieved: MLENERGY_RETRIEVED,
    note:
      "Accelerator energy only; host and facility overhead applied separately. " +
      "Band is the p10–p90 spread across measured serving configurations, which " +
      "an API customer cannot observe or control.",
  };
}

/**
 * Class averages, derived from the measurements rather than asserted.
 * Used when the specific model is not in the benchmark — which is every
 * commercial API model.
 */
export const CLASS_ENERGY: Readonly<Record<ModelClass, ModelEnergyFactor>> = {
  small: {
    id: "model.class.small",
    whPer1kOutput: MLENERGY_CLASS.small.mid,
    whPer1kOutputLow: MLENERGY_CLASS.small.lo,
    whPer1kOutputHigh: MLENERGY_CLASS.small.hi,
    prefillRatio: PREFILL_RATIO,
    cacheRatio: CACHE_RATIO,
    class: "small",
    ref: mlRef("model.class.small", "chat task, ≤9B activated parameters", MLENERGY_CLASS.small.configs),
  },
  mid: {
    id: "model.class.mid",
    whPer1kOutput: MLENERGY_CLASS.mid.mid,
    whPer1kOutputLow: MLENERGY_CLASS.mid.lo,
    whPer1kOutputHigh: MLENERGY_CLASS.mid.hi,
    prefillRatio: PREFILL_RATIO,
    cacheRatio: CACHE_RATIO,
    class: "mid",
    ref: mlRef("model.class.mid", "chat task, 9–32B activated parameters", MLENERGY_CLASS.mid.configs),
  },
  large: {
    id: "model.class.large",
    whPer1kOutput: MLENERGY_CLASS.large.mid,
    whPer1kOutputLow: MLENERGY_CLASS.large.lo,
    whPer1kOutputHigh: MLENERGY_CLASS.large.hi,
    prefillRatio: PREFILL_RATIO,
    cacheRatio: CACHE_RATIO,
    class: "large",
    ref: mlRef("model.class.large", "chat task, >32B activated parameters", MLENERGY_CLASS.large.configs),
  },
  reasoning: {
    id: "model.class.reasoning",
    whPer1kOutput: MLENERGY_CLASS.reasoning.mid,
    whPer1kOutputLow: MLENERGY_CLASS.reasoning.lo,
    whPer1kOutputHigh: MLENERGY_CLASS.reasoning.hi,
    prefillRatio: PREFILL_RATIO,
    cacheRatio: CACHE_RATIO,
    class: "reasoning",
    ref: mlRef(
      "model.class.reasoning",
      "GPQA task, ≥20B activated parameters",
      MLENERGY_CLASS.reasoning.configs,
    ),
  },
} as const;

/**
 * Model-class routing. Pattern-based rather than an exhaustive table, because a
 * hardcoded model list goes stale within weeks and a confidently wrong class is
 * worse than an honest fallback.
 *
 * ── Every token is anchored to a separator, and that is not optional ─────────
 *
 * An unanchored substring match is a silent, systematic mis-estimate. The one
 * that got through review: `gemini-3-pro` contains "mini", so it classified as a
 * small model and every Gemini call was understated roughly fourfold. Nothing
 * failed — the numbers were just quietly wrong, which is the worst outcome this
 * library can produce.
 *
 * It was caught by the reconciliation test against Google's published figure, not
 * by reading the regex. Keep that test, and anchor anything you add here.
 *
 * ── Anchoring is necessary but not sufficient: watch for negation ────────────
 *
 * The second one, found in the first real customer fleet rather than in review:
 * `grok-4-1-fast-non-reasoning` is anchored perfectly — `-reasoning` sits behind
 * a separator — and it classified as a *reasoning* model. The name says the
 * opposite. That put a mid-class model on the reasoning energy curve and
 * overstated its footprint roughly threefold.
 *
 * Overstating is not the safe direction. A customer who discovers we inflated
 * their number has the same reason to distrust every other figure as one who
 * discovers we shrank it, and providers name models by what they are not
 * ("non-reasoning", "non-thinking") often enough that this will recur.
 */
const SEP = String.raw`(^|[-_./])`;

/** `non-` / `no-` immediately before the separator negates the token after it. */
const NOT_NEGATED = String.raw`(?<!\bno|\bnon)`;

const CLASS_PATTERNS: ReadonlyArray<readonly [RegExp, ModelClass]> = [
  [new RegExp(`${NOT_NEGATED}${SEP}(o[1-9]|r1|reason\\w*|thinking|deepseek-r)`, "i"), "reasoning"],
  [new RegExp(`${SEP}(haiku|mini|nano|small|flash-lite|[1-9]b)(?![a-z0-9])`, "i"), "small"],
  [new RegExp(`${SEP}(opus|ultra|405b|large)|(-4\\.5)`, "i"), "large"],
  [new RegExp(`${SEP}(sonnet|gpt-4o|gpt-5|flash|70b|mid)|gemini.*pro`, "i"), "mid"],
];

export function classifyModel(model: string, fallback: ModelClass = "mid"): ModelClass {
  for (const [pattern, cls] of CLASS_PATTERNS) {
    if (pattern.test(model)) return cls;
  }
  return fallback;
}

function classForParams(activatedB: number, regime: EnergyRegime): ModelClass {
  if (regime === "reasoning") return "reasoning";
  if (activatedB <= 9) return "small";
  if (activatedB <= 32) return "mid";
  return "large";
}

function buildModelEnergy(): Map<string, ModelEnergyFactor> {
  const map = new Map<string, ModelEnergyFactor>();
  for (const row of MLENERGY_ROWS) {
    const key = row.regime === "reasoning" ? `${row.modelId}#reasoning` : row.modelId;
    // Both spellings — ML.ENERGY ids contain dots (llama-3.1-8b-instruct) and the
    // collector normalises them away. See factors/normalize.ts.
    indexBothSpellings(map, key, {
      id: `model.${key}`,
      whPer1kOutput: row.mid,
      whPer1kOutputLow: row.lo,
      whPer1kOutputHigh: row.hi,
      prefillRatio: PREFILL_RATIO,
      cacheRatio: CACHE_RATIO,
      class: classForParams(row.activatedParamsB, row.regime),
      ref: mlRef(
        `model.${key}`,
        `${row.modelId} (${row.architecture}, ${row.activatedParamsB}B activated of ${row.totalParamsB}B, ${row.gpus}), ${row.regime} task`,
        row.configs,
      ),
    });
  }
  return map;
}

/** Measured per-model factors, keyed by lowercase model id. */
export const MODEL_ENERGY: ReadonlyMap<string, ModelEnergyFactor> = buildModelEnergy();

/**
 * Short names people actually pass, mapped to benchmark ids. Deliberately short —
 * an over-eager alias table produces confidently wrong attributions, which is
 * worse than falling back to a class average.
 */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ["llama-3.1-8b-instruct", "meta-llama/llama-3.1-8b-instruct"],
  ["llama-3.1-70b-instruct", "meta-llama/llama-3.1-70b-instruct"],
  ["llama-3.3-70b-instruct", "meta-llama/llama-3.3-70b-instruct"],
  ["llama-3.1-405b-instruct", "meta-llama/llama-3.1-405b-instruct"],
  ["qwen3-8b", "qwen/qwen3-8b"],
  ["qwen3-14b", "qwen/qwen3-14b"],
  ["qwen3-32b", "qwen/qwen3-32b"],
  ["gemma-3-12b-it", "google/gemma-3-12b-it"],
  ["gemma-3-27b-it", "google/gemma-3-27b-it"],
  ["deepseek-v3.1", "deepseek-ai/deepseek-v3.1"],
  ["deepseek-r1", "deepseek-ai/deepseek-r1-0528"],
  ["deepseek-r1-0528", "deepseek-ai/deepseek-r1-0528"],
  ["gpt-oss-20b", "openai/gpt-oss-20b"],
  ["gpt-oss-120b", "openai/gpt-oss-120b"],
]);

export interface ResolvedModelEnergy {
  readonly factor: ModelEnergyFactor;
  /** 2 when a measured model-specific factor was found, 1 when we fell back. */
  readonly tier: 1 | 2;
}

/**
 * Resolve energy for a model.
 *
 * `reasoningRegime` selects the long-context measurement where one exists — pass
 * true when the call reported reasoning tokens, since attention cost over a long
 * context is materially higher than the same model doing chat.
 */
export function resolveModelEnergy(
  model: string,
  fallbackClass: ModelClass = "mid",
  reasoningRegime = false,
): ResolvedModelEnergy {
  const raw = model.toLowerCase();

  // Try both spellings: the collector normalises "3.1" to "3-1", but ML.ENERGY
  // ids carry dots (meta-llama/llama-3.1-8b-instruct). Missing here would have
  // silently demoted a genuinely benchmarked model to a Tier 1 class average.
  for (const form of [raw, normalizeModelId(raw)]) {
    const canonical = ALIASES.get(form) ?? form;

    if (reasoningRegime) {
      const reasoning = MODEL_ENERGY.get(`${canonical}#reasoning`);
      if (reasoning) return { factor: reasoning, tier: 2 };
    }

    const specific = MODEL_ENERGY.get(canonical);
    if (specific) return { factor: specific, tier: 2 };
  }

  const cls = reasoningRegime ? "reasoning" : classifyModel(model, fallbackClass);
  return { factor: CLASS_ENERGY[cls], tier: 1 };
}

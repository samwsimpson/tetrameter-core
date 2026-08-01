/**
 * The factor set: every coefficient the engine uses, versioned as one unit.
 *
 * Versioning the whole set together rather than each factor individually is
 * deliberate. A report says "computed against factor set 2026.08.0", and that one
 * string is enough for someone else to reproduce the number exactly. Per-factor
 * versioning would make that sentence a paragraph.
 */

import { RestatementLog, type Restatement } from "../provenance.js";

export * from "./normalize.js";
export * from "./mlenergy.js";
export * from "./models.js";
export * from "./grid.js";
export * from "./grid-providers.js";
export type { GridZoneRow } from "./grid-data.js";
export * from "./overhead.js";
export * from "./pricing.js";
export type { PricingTuple } from "./pricing-data.js";

/**
 * Current factor set version. Bumping this is a restatement event and must be
 * recorded in `RESTATEMENTS` below with a reason and a materiality estimate.
 *
 * Format: YYYY.MM.PATCH
 */
export const FACTOR_SET_VERSION = "2026.08.2";

export const FACTOR_SET_NOTES = [
  "Model energy comes from the ML.ENERGY Benchmark (328 serving configurations,",
  "24 open-weight models, H100 and B200). Bands are the p10–p90 spread across",
  "serving configurations, which an API customer cannot observe. Commercial API",
  "models are not in the benchmark and resolve to class averages at Tier 1 —",
  "provider transparency, not our effort, is the binding constraint. Grid factors",
  "remain annual averages pending live Electricity Maps and WattTime integration,",
  "so no figure from this set belongs in a filed disclosure without its",
  "uncertainty band and tier label.",
].join(" ");

/**
 * The restatement log for the shipped factor sets.
 *
 * When a coefficient changes, every historical figure computed from it moves. In
 * a disclosed inventory that is a restatement event requiring documentation, and
 * no other tool in this market handles it. Keeping the log in the library rather
 * than in a wiki means a report can cite it mechanically.
 *
 * Materiality is expressed as the fractional change in affected figures:
 * -0.60 means restated figures are 60% lower than previously reported.
 */
const log = new RestatementLog();

const RESTATEMENT_ENTRIES: readonly Restatement[] = [
  {
    factorId: "model.class.reasoning",
    fromVersion: "2026.08.1",
    toVersion: "2026.08.2",
    applied: "2026-08-01",
    reason:
      "Corrected a classification error, not a coefficient. Model names that negate a capability " +
      "(\"grok-4-1-fast-non-reasoning\", \"...-non-thinking\") matched the reasoning pattern on the " +
      "very token that denies it, placing mid-class models on the reasoning energy curve. Affected " +
      "figures were overstated by roughly 3x for those calls only; models whose names do not negate " +
      "are unchanged. Found in the first production customer fleet rather than in review — the " +
      "separator anchoring introduced in 2026.08.0 was satisfied and still permitted this.",
    materialityEstimate: -0.66,
  },
  {
    factorId: "model.class.*",
    fromVersion: "2026.07.0",
    toVersion: "2026.08.0",
    applied: "2026-07-31",
    reason:
      "Replaced bootstrap class averages with measured per-model energy from the ML.ENERGY " +
      "Benchmark (arXiv:2505.06371), the benchmark EcoLogits adopted in 2026. Bootstrap values " +
      "were asserted from published anchors; these are measured across 328 serving configurations. " +
      "Uncertainty bands are now derived from the observed spread rather than chosen.",
    materialityEstimate: -0.6,
  },
  {
    factorId: "model.class.reasoning",
    fromVersion: "2026.07.0",
    toVersion: "2026.08.0",
    applied: "2026-07-31",
    reason:
      "Corrected a modelling error. The bootstrap applied a 4.5x per-token energy premium to " +
      "reasoning models. Measurement shows the premium for a given model is roughly 2–3x and " +
      "comes from long-context attention, not from the model being a reasoning model. The real " +
      "cost driver is token count — median output length 5,400–11,445 on GPQA against 634 on " +
      "chat — which was already modelled separately and was therefore being double-counted.",
    materialityEstimate: -0.45,
  },
  {
    factorId: "overhead.host",
    fromVersion: "2026.07.0",
    toVersion: "2026.08.0",
    applied: "2026-07-31",
    reason:
      "New factor. ML.ENERGY measures the accelerator at the device, while the bootstrap figures " +
      "were loosely full-stack. Introducing an explicit host and idle/reserve overhead multiplier " +
      "(2.23x, derived by reconciling against Google's published median Gemini prompt net of " +
      "their fleet PUE) makes the boundary explicit rather than smuggled into the model factor.",
    materialityEstimate: 1.23,
  },
  {
    factorId: "grid.*",
    fromVersion: "2026.07.0",
    toVersion: "2026.08.0",
    applied: "2026-07-31",
    reason:
      "Replaced 8 hand-written zones with ~200 country zones from Ember via Our World in Data " +
      "(CC BY), latest year per country. The previous marginal figures were invented outright; " +
      "they are now inferred from actual fossil generation mix and flagged as estimates, and " +
      "resolveGrid refuses to serve one to a reduction claim without an explicit opt-in. Zones " +
      "with under 5% fossil generation now return no marginal at all rather than a number that " +
      "looks authoritative and means nothing. Sub-national zones resolve to country level with " +
      "the downgrade recorded on the factor reference.",
    materialityEstimate: 0.05,
  },
  {
    factorId: "grid.land",
    fromVersion: "2026.08.0",
    toVersion: "2026.08.1",
    applied: "2026-08-01",
    reason:
      "New resource. Land use is now measured as the fourth resource, derived per zone from the " +
      "generation mix already ingested for the marginal inference. Band spans direct physical " +
      "footprint to footprint-plus-spacing (a ~92x range for wind) rather than picking the " +
      "flattering end. Note the uncomfortable consequence, published rather than buried: " +
      "renewable-heavy grids frequently score WORSE on land than coal-heavy ones — Great Britain " +
      "near 960 cm2/kWh against South Africa's 172, while emitting a third of the carbon.",
    materialityEstimate: 0,
  },
  {
    factorId: "pricing.*",
    fromVersion: "2026.07.0",
    toVersion: "2026.08.0",
    applied: "2026-07-31",
    reason:
      "Replaced four hand-written class stubs with the LiteLLM price catalogue (MIT) — ~2,100 " +
      "chat models across every major provider, including Bedrock, Azure, Vertex and aggregator " +
      "pricing, which differs from direct-API pricing for the same model. The stubs were " +
      "materially wrong: the large class was priced at $15/$75 per 1M against Claude Opus 5's " +
      "actual $5/$25, overstating spend roughly threefold and inflating every savings figure " +
      "derived from it. Class fallbacks are now catalogue medians rather than guesses.",
    materialityEstimate: -0.65,
  },
  {
    factorId: "model.prefillRatio",
    fromVersion: "2026.07.0",
    toVersion: "2026.08.0",
    applied: "2026-07-31",
    reason:
      "Reduced from 0.12–0.15 to 0.05. The ML.ENERGY per-token figure is total request energy " +
      "divided by output tokens, so a typical prompt's prefill is already amortised in. The " +
      "previous ratio double-counted it. The remaining 0.05 covers input beyond a typical prompt.",
    materialityEstimate: -0.08,
  },
];

for (const entry of RESTATEMENT_ENTRIES) log.add(entry);

/** Restatements applied across shipped factor sets, newest first per factor. */
export const RESTATEMENTS: RestatementLog = log;

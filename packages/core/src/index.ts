/**
 * Reference implementation of the Green Software Foundation SCI for AI
 * specification, for LLM inference bought as a third-party API.
 *
 * Three rules the library enforces rather than documents:
 *
 *   1. No bare numbers. Every value carries an uncertainty band, an evidence tier,
 *      and its source factors. See `quantity.ts`.
 *   2. No prompt content. The wire model accepts metadata only, so carbon and cost
 *      can be computed without the content ever leaving the customer's boundary.
 *   3. Average grid intensity for inventory, marginal for reduction claims — and
 *      the library refuses to silently substitute one for the other. See `grid.ts`.
 *
 * Everything here is deterministic and reproducible from a factor set version.
 * No model is ever asked to produce a number that goes into a report.
 */

export { BRAND, type Brand } from "./brand.js";

export {
  quantity,
  exact,
  scale,
  scaleBy,
  applyOverhead,
  sum,
  bandWidth,
  isWideBand,
  formatQuantity,
  type Quantity,
  type QuantityInit,
  type Unit,
  type FormatOptions,
} from "./quantity.js";

export {
  TIERS,
  MAX_TIER_WITHOUT_PROVIDER_DISCLOSURE,
  describeTier,
  weakestTier,
  type Tier,
  type TierDefinition,
} from "./tiers.js";

export {
  RestatementLog,
  type FactorRef,
  type FactorKind,
  type Restatement,
} from "./provenance.js";

export type {
  CallRecord,
  TraceRecord,
  Footprint,
  GridSignal,
  ComputeOptions,
  ModelClass,
} from "./types.js";

export {
  FACTOR_SET_VERSION,
  FACTOR_SET_NOTES,
  RESTATEMENTS,
  CLASS_ENERGY,
  MODEL_ENERGY,
  classifyModel,
  resolveModelEnergy,
  normalizeModelId,
  indexBothSpellings,
  MLENERGY_ROWS,
  MLENERGY_CLASS,
  MLENERGY_SNAPSHOT,
  MLENERGY_RETRIEVED,
  GRID,
  GRID_ZONES,
  GRID_SOURCE,
  GRID_RETRIEVED,
  MARGINAL_METHOD,
  DEFAULT_ZONE,
  resolveGrid,
  resolveLand,
  GLOBAL_LAND,
  MarginalSignalUnavailableError,
  StaticGridProvider,
  ElectricityMapsProvider,
  WattTimeProvider,
  FallbackGridProvider,
  type GridZoneRow,
  type GridDataProvider,
  type GridQuery,
  type GridReading,
  type ResolveGridOptions,
  type HttpGridProviderOptions,
  HOST_OVERHEAD,
  PUE,
  WATER_ONSITE,
  WATER_OFFSITE,
  EMBODIED_RATIO,
  PRICING,
  PRICING_ROWS,
  PRICING_CLASS_MEDIAN, CACHE_WRITE_PREMIUM,
  PRICING_SOURCE,
  PRICING_RETRIEVED,
  resolvePricing,
  CLOUD_REGIONS,
  CLOUD_REGION_COUNT,
  zoneForCloudRegion,
  isModelSpecificPricing,
  type PricingClass,
  type ModelEnergyFactor,
  type MlEnergyRow,
  type EnergyRegime,
  type GridFactor,
  type ResolvedGrid,
  type ResolvedLand,
  type OverheadFactor,
  type PricingFactor,
} from "./factors/index.js";

export {
  callEnergy,
  callCarbon,
  callWater,
  callLand,
  callCost,
  computeCall,
} from "./compute/call.js";

export {
  computeTrace,
  groupIntoTraces,
  sci,
  efficiencyTrend,
  type TraceFootprint,
  type EfficiencyPoint,
} from "./compute/trace.js";

// Waste detection lives in @kumokodo/tetrameter-insights and is deliberately
// not published. The line: this library exposes anything that produces a number
// you would disclose; the recommendation engine we bill against stays closed.

export {
  rollup,
  rollupTotal,
  efficiencyByPeriod,
  periodKey,
  levelFor,
  MIXED,
  UNATTRIBUTED,
  CALL_LEVEL_DIMENSIONS,
  type Dimension,
  type Period,
  type RollupGroup,
  type RollupOptions,
  type RollupLevel,
  type TierDistribution,
} from "./compute/rollup.js";

export {
  buildEvidencePack,
  renderEvidencePack,
  type EvidencePack,
  type EvidencePackOptions,
} from "./report/evidence-pack.js";

export { renderEvidencePackHtml } from "./report/html.js";

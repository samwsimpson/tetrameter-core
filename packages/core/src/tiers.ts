/**
 * The four-tier evidence framework for AI inference under GHG Protocol Scope 3
 * Category 1, after Cook et al., "Accounting for AI Inference in Corporate GHG
 * Inventories" (arXiv:2606.10660).
 *
 * The tier travels with every number so an auditor can see, per line item, what
 * kind of evidence sits behind it. A report that is 90% Tier 2 is a different
 * object from one that is 90% Tier 1, and the difference must be visible without
 * reading the methodology appendix.
 */

export type Tier = 1 | 2 | 3 | 4;

export interface TierDefinition {
  readonly tier: Tier;
  readonly label: string;
  readonly description: string;
  /** What the organisation must have access to in order to claim this tier. */
  readonly requires: string;
  /** Rough band width to expect at this tier, as a fraction of the central value. */
  readonly typicalBandWidth: number;
}

export const TIERS: Readonly<Record<Tier, TierDefinition>> = {
  1: {
    tier: 1,
    label: "Class average",
    description:
      "Generic electricity carbon intensity and model-class average power. Used when only " +
      "spend or coarse call volume is known.",
    requires: "Call counts or spend, by rough model class.",
    typicalBandWidth: 2.0,
  },
  2: {
    tier: 2,
    label: "Model and region specific",
    description:
      "Per-model energy from a published benchmark (ML.ENERGY, AI Energy Score) combined " +
      "with region-specific grid intensity. The realistic ceiling for third-party API usage.",
    requires: "Per-call model identity, token counts, and the serving region.",
    typicalBandWidth: 0.8,
  },
  3: {
    tier: 3,
    label: "Measured power",
    description:
      "Actual measured power draw from hardware telemetry with location-specific grid " +
      "intensity. Available for self-hosted inference, or via a provider that discloses it.",
    requires: "GPU/host telemetry, or provider-disclosed per-request energy.",
    typicalBandWidth: 0.25,
  },
  4: {
    tier: 4,
    label: "Measured power, dynamic grid",
    description:
      "Real-time measured power with time-matched grid intensity and model-level attribution. " +
      "Also the tier for exactly-known quantities such as billed cost and token counts.",
    requires: "Real-time telemetry plus a time-resolved grid signal.",
    typicalBandWidth: 0.1,
  },
} as const;

/**
 * Provider transparency is the binding constraint on tier, not our engineering effort.
 * For third-party APIs where the provider publishes nothing per-request, Tier 2 is the
 * honest ceiling however much we would like to claim otherwise.
 */
export const MAX_TIER_WITHOUT_PROVIDER_DISCLOSURE: Tier = 2;

export function describeTier(tier: Tier): TierDefinition {
  return TIERS[tier];
}

/** A chain of evidence is only as strong as its weakest link. */
export function weakestTier(tiers: readonly Tier[]): Tier {
  return tiers.reduce<Tier>((worst, t) => (t < worst ? t : worst), 4);
}

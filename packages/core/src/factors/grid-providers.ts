/**
 * Grid data providers.
 *
 * The static table is annual country averages — good enough to compute with,
 * nowhere near good enough to file. This is the seam that live data drops into
 * when we buy it, so the rest of the engine never has to change.
 *
 * Two things live data fixes that the static table structurally cannot:
 *
 *   1. **Time resolution.** A call at 03:00 and one at 18:00 currently get the
 *      same factor. Intraday intensity routinely varies two- to threefold, so
 *      this is a large error we simply cannot see today.
 *   2. **Real marginal.** Our marginal figures are inferred from fossil mix.
 *      WattTime measures MOER by regressing emissions against load. Only the
 *      measured version can carry a reduction claim without a caveat.
 *
 * Adapters are written and tested against recorded fixtures rather than the
 * network. Tests must never make live calls: a test suite that fails because a
 * third party rate-limited you teaches the team to ignore red builds.
 */

import type { FactorRef } from "../provenance.js";
import type { GridSignal } from "../types.js";
import type { Tier } from "../tiers.js";
import { resolveGrid, type ResolvedGrid, type ResolveGridOptions } from "./grid.js";

export interface GridQuery {
  readonly zone: string;
  /** ISO 8601. Providers with time resolution use it; the static table ignores it. */
  readonly at?: string;
  readonly signal?: GridSignal;
}

export interface GridReading extends ResolvedGrid {
  /** Evidence tier this provider can support. */
  readonly tier: Tier;
  /** Whether the figure was resolved for the requested instant or is a period average. */
  readonly timeResolved: boolean;
}

export interface GridDataProvider {
  readonly name: string;
  /** Highest tier this provider can support. */
  readonly maxTier: Tier;
  get(query: GridQuery): Promise<GridReading>;
}

/**
 * The default. Country annual averages plus fossil-mix-inferred marginal.
 * Tier 1: not time-resolved, and the marginal side is an inference.
 */
export class StaticGridProvider implements GridDataProvider {
  readonly name = "static";
  readonly maxTier: Tier = 1;

  constructor(private readonly opts: ResolveGridOptions = {}) {}

  async get(query: GridQuery): Promise<GridReading> {
    const resolved = resolveGrid(query.zone, query.signal ?? "average", this.opts);
    return { ...resolved, tier: 1, timeResolved: false };
  }
}

export interface HttpGridProviderOptions {
  readonly apiKey: string;
  /** Injectable so tests run against fixtures and never touch the network. */
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

/**
 * Electricity Maps — time-resolved *average* (location-based) intensity across
 * 200+ zones, including sub-national grids the static table cannot represent.
 *
 * It does not publish a marginal signal, so marginal requests fall through to
 * whatever the caller configured as a fallback rather than being silently served
 * an average dressed up as a marginal. That substitution is the single most
 * common way a savings claim becomes indefensible.
 *
 * Licence not yet purchased (~€6,000/yr per signal). This adapter exists so the
 * integration is a config change rather than a refactor.
 */
export class ElectricityMapsProvider implements GridDataProvider {
  readonly name = "electricity-maps";
  readonly maxTier: Tier = 3;

  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #base: string;

  constructor(opts: HttpGridProviderOptions) {
    this.#key = opts.apiKey;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#base = opts.baseUrl ?? "https://api.electricitymaps.com/v3";
  }

  async get(query: GridQuery): Promise<GridReading> {
    if ((query.signal ?? "average") === "marginal") {
      throw new Error(
        "Electricity Maps does not publish a marginal signal. Use a WattTime provider for " +
          "reduction claims rather than substituting an average — that is how savings get overstated.",
      );
    }

    const path = query.at
      ? `/carbon-intensity/past?zone=${encodeURIComponent(query.zone)}&datetime=${encodeURIComponent(query.at)}`
      : `/carbon-intensity/latest?zone=${encodeURIComponent(query.zone)}`;

    const res = await this.#fetch(`${this.#base}${path}`, {
      headers: { "auth-token": this.#key },
    });
    if (!res.ok) {
      throw new Error(`Electricity Maps returned ${res.status} for zone ${query.zone}`);
    }

    const body = (await res.json()) as { carbonIntensity?: number; datetime?: string };
    if (typeof body.carbonIntensity !== "number") {
      throw new Error(`Electricity Maps returned no carbonIntensity for zone ${query.zone}`);
    }

    const value = body.carbonIntensity;
    const ref: FactorRef = {
      id: `grid.${query.zone}.live`,
      kind: "grid-intensity",
      version: "live",
      source: `Electricity Maps, ${body.datetime ?? "latest"}`,
      url: "https://www.electricitymaps.com/",
      retrieved: body.datetime ?? new Date(0).toISOString(),
      note: "Time-resolved location-based intensity. Measured, not inferred.",
    };

    return {
      // A measured reading still carries reporting uncertainty; ±10% is the
      // published-instrument band, far tighter than the static table's.
      gco2ePerKwh: value,
      low: value * 0.9,
      high: value * 1.1,
      signal: "average",
      estimated: false,
      zone: query.zone,
      ref,
      tier: 3,
      timeResolved: Boolean(query.at || body.datetime),
    };
  }
}

/**
 * WattTime — measured marginal operating emissions rate (MOER), the signal a
 * reduction claim actually needs.
 *
 * WattTime derives MOER by regressing observed grid emissions against load with
 * confounders controlled, which is exactly the counterfactual our fossil-mix
 * inference is standing in for. Once this is wired, marginal figures stop being
 * estimates and `allowEstimatedMarginal` stops being necessary.
 *
 * Commercial pricing is not public; budgeted at roughly $9,000/yr. Not purchased.
 */
export class WattTimeProvider implements GridDataProvider {
  readonly name = "watttime";
  readonly maxTier: Tier = 4;

  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #base: string;

  constructor(opts: HttpGridProviderOptions) {
    this.#key = opts.apiKey;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#base = opts.baseUrl ?? "https://api.watttime.org/v3";
  }

  async get(query: GridQuery): Promise<GridReading> {
    const signal = query.signal ?? "marginal";
    if (signal === "average") {
      throw new Error(
        "WattTime publishes marginal emissions. Use Electricity Maps for the location-based " +
          "average an inventory requires.",
      );
    }

    const params = new URLSearchParams({ region: query.zone, signal_type: "co2_moer" });
    if (query.at) params.set("start", query.at);

    const res = await this.#fetch(`${this.#base}/historical?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.#key}` },
    });
    if (!res.ok) {
      throw new Error(`WattTime returned ${res.status} for region ${query.zone}`);
    }

    const body = (await res.json()) as {
      data?: ReadonlyArray<{ value?: number; point_time?: string }>;
      meta?: { model?: string };
    };
    const point = body.data?.[0];
    if (typeof point?.value !== "number") {
      throw new Error(`WattTime returned no MOER value for region ${query.zone}`);
    }

    // WattTime reports MOER in lbs CO2e per MWh.
    const LBS_PER_MWH_TO_G_PER_KWH = 453.59237 / 1000;
    const value = point.value * LBS_PER_MWH_TO_G_PER_KWH;

    const ref: FactorRef = {
      id: `grid.${query.zone}.moer`,
      kind: "grid-intensity",
      version: body.meta?.model ?? "live",
      source: `WattTime MOER${body.meta?.model ? `, model ${body.meta.model}` : ""}`,
      url: "https://watttime.org/",
      retrieved: point.point_time ?? new Date(0).toISOString(),
      note:
        "Measured marginal operating emissions rate. Correct signal for reduction claims; " +
        "do not use it for inventory reporting, which requires the location-based average.",
    };

    return {
      gco2ePerKwh: value,
      low: value * 0.85,
      high: value * 1.15,
      signal: "marginal",
      estimated: false,
      zone: query.zone,
      ref,
      tier: 4,
      timeResolved: true,
    };
  }
}

/**
 * Try providers in order, falling back on failure.
 *
 * Falls back on *unavailability*, never on signal mismatch: if a provider refuses
 * to serve a marginal request because it only has averages, that refusal
 * propagates. Degrading to a worse-but-available number is fine; degrading to the
 * wrong *kind* of number is not.
 */
export class FallbackGridProvider implements GridDataProvider {
  readonly name = "fallback";
  readonly maxTier: Tier;

  constructor(private readonly providers: readonly GridDataProvider[]) {
    if (providers.length === 0) throw new Error("FallbackGridProvider needs at least one provider");
    this.maxTier = providers.reduce<Tier>((best, p) => (p.maxTier > best ? p.maxTier : best), 1);
  }

  async get(query: GridQuery): Promise<GridReading> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await provider.get(query);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`No grid provider could serve zone ${query.zone}`);
  }
}

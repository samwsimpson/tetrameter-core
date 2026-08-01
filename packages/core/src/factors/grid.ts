/**
 * Grid carbon intensity — average and marginal.
 *
 * The distinction here is the most consequential methodological choice in the
 * library, and the one the rest of the market gets wrong.
 *
 *   AVERAGE (location-based) is the weighted mean intensity of all generation
 *   serving the grid. It is what GHG Protocol requires for an inventory:
 *   "what share of total grid emissions is attributable to my consumption."
 *
 *   MARGINAL (MOER) is the intensity of the generators that actually respond to a
 *   change in load. It is what is physically true for a *reduction claim*:
 *   "what changes if I stop doing this."
 *
 * Published work on carbon-aware scheduling found the same intervention reading
 * 18% savings on the average signal and 11% on marginal — and, critically, that
 * "carbon savings only manifest when the same signal is used to compute savings;
 * based on the other signal, carbon savings are negative"
 * (ACM e-Energy, 10.1145/3632775.3661953).
 *
 * ── On our marginal figures specifically ─────────────────────────────────────
 *
 * They are inferred from fossil generation mix, not measured. A real MOER comes
 * from regressing grid emissions against load, which is what WattTime sells and
 * what we have not bought. So every marginal figure in the static table is
 * flagged `estimated`, and `resolveGrid` refuses to hand one to a reduction claim
 * unless the caller explicitly opts in.
 *
 * That refusal is the point. The failure mode here is not being wrong — it is
 * being wrong in the direction that flatters the customer, quietly, in a document
 * that goes to a regulator.
 */

import type { FactorRef } from "../provenance.js";
import type { GridSignal } from "../types.js";
import {
  GRID_ZONES,
  GRID_SOURCE,
  GRID_SOURCE_URL,
  GRID_RETRIEVED,
  MARGINAL_METHOD,
  type GridZoneRow,
} from "./grid-data.js";

export interface GridFactor {
  readonly zone: string;
  readonly label: string;
  readonly year: number;
  /** gCO2e per kWh, location-based average. */
  readonly averageGco2ePerKwh: number;
  readonly averageLow: number;
  readonly averageHigh: number;
  /** gCO2e per kWh, marginal. Undefined where it cannot be responsibly inferred. */
  readonly marginalGco2ePerKwh?: number;
  readonly marginalLow?: number;
  readonly marginalHigh?: number;
  /** True while the marginal figure is inferred rather than measured. */
  readonly marginalEstimated: boolean;
  readonly fossilShare?: number;
  /** Land-use intensity, cm² per kWh, derived from the zone's generation mix. */
  readonly landCm2PerKwh?: number;
  readonly landLow?: number;
  readonly landHigh?: number;
  readonly ref: FactorRef;
}

const VERSION = "2026.08.0";

function gridRef(row: GridZoneRow): FactorRef {
  return {
    id: `grid.${row.zone}`,
    kind: "grid-intensity",
    version: VERSION,
    source: `${GRID_SOURCE} — ${row.label}, ${row.year} annual average`,
    url: GRID_SOURCE_URL,
    retrieved: GRID_RETRIEVED,
    note:
      `Annual average, not time-resolved: a call at 03:00 and one at 18:00 get the same factor. ` +
      `Any marginal figure for this zone is ${MARGINAL_METHOD}, inferred rather than measured.`,
  };
}

function toFactor(row: GridZoneRow): GridFactor {
  return {
    zone: row.zone,
    label: row.label,
    year: row.year,
    averageGco2ePerKwh: row.avg,
    averageLow: row.avgLow,
    averageHigh: row.avgHigh,
    ...(row.marginal !== null
      ? {
          marginalGco2ePerKwh: row.marginal,
          marginalLow: row.marginalLow ?? row.marginal,
          marginalHigh: row.marginalHigh ?? row.marginal,
        }
      : {}),
    marginalEstimated: true,
    ...(row.fossilShare !== null ? { fossilShare: row.fossilShare } : {}),
    ...(row.landCm2PerKwh !== null
      ? {
          landCm2PerKwh: row.landCm2PerKwh,
          landLow: row.landLow ?? row.landCm2PerKwh,
          landHigh: row.landHigh ?? row.landCm2PerKwh,
        }
      : {}),
    ref: gridRef(row),
  };
}

/**
 * Global fallback land intensity, cm² per kWh, for zones with no generation mix.
 * Mid-range of the observed distribution with a deliberately wide band.
 */
export const GLOBAL_LAND = { value: 400, low: 120, high: 1200 } as const;

export interface ResolvedLand {
  readonly cm2PerKwh: number;
  readonly low: number;
  readonly high: number;
  readonly zone: string;
  readonly ref: FactorRef;
}

export function resolveLand(zone: string | undefined): ResolvedLand {
  const factor = lookup(zone);
  return {
    cm2PerKwh: factor.landCm2PerKwh ?? GLOBAL_LAND.value,
    low: factor.landLow ?? GLOBAL_LAND.low,
    high: factor.landHigh ?? GLOBAL_LAND.high,
    zone: factor.zone,
    ref: { ...factor.ref, id: `${factor.ref.id}.land` },
  };
}

/** Global average, for when no region is known at all. */
const GLOBAL: GridFactor = {
  zone: "GLOBAL",
  label: "Global average",
  year: 2025,
  averageGco2ePerKwh: 475,
  averageLow: 430,
  averageHigh: 520,
  marginalEstimated: true,
  ref: {
    id: "grid.GLOBAL",
    kind: "grid-intensity",
    version: VERSION,
    source: `${GRID_SOURCE} — world average`,
    url: GRID_SOURCE_URL,
    retrieved: GRID_RETRIEVED,
    note:
      "Global fallback, used when no region is known. Carries no marginal figure at all: " +
      "'the marginal generator of the world' is not a meaningful quantity.",
  },
};

function buildGrid(): Map<string, GridFactor> {
  const map = new Map<string, GridFactor>();
  map.set(GLOBAL.zone, GLOBAL);
  for (const row of GRID_ZONES) map.set(row.zone, toFactor(row));
  return map;
}

export const GRID: ReadonlyMap<string, GridFactor> = buildGrid();
export const DEFAULT_ZONE = "GLOBAL";

export class MarginalSignalUnavailableError extends Error {
  constructor(
    readonly zone: string,
    reason: string,
  ) {
    super(
      `No marginal factor available for zone "${zone}": ${reason}\n` +
        `A reduction claim must not silently fall back to the average signal — that is how ` +
        `savings get overstated. Either source a measured MOER for this zone, pass ` +
        `{ allowEstimatedMarginal: true } to accept an inferred figure, or report the ` +
        `reduction as unquantified.`,
    );
    this.name = "MarginalSignalUnavailableError";
  }
}

export interface ResolveGridOptions {
  /**
   * Accept a fossil-mix-inferred marginal figure where no measured MOER exists.
   *
   * Off by default, and deliberately awkward. Turning it on is a statement that
   * you understand the figure is an inference and will present it as one.
   */
  readonly allowEstimatedMarginal?: boolean;
}

export interface ResolvedGrid {
  readonly gco2ePerKwh: number;
  readonly low: number;
  readonly high: number;
  readonly signal: GridSignal;
  /** True when the figure is inferred rather than measured. */
  readonly estimated: boolean;
  readonly zone: string;
  readonly ref: FactorRef;
}

/**
 * Look up a zone, falling back one level for sub-national codes.
 *
 * `US-CAISO` resolves to `US` with a note recorded on the factor reference,
 * because we hold country-level annual averages only. Sub-national resolution
 * needs the live Electricity Maps adapter. The note matters: it travels into the
 * export pack, so an auditor sees that the figure is coarser than the zone code
 * implies rather than discovering it later.
 */
function lookup(zone: string | undefined): GridFactor {
  const key = zone ?? DEFAULT_ZONE;
  const exact = GRID.get(key);
  if (exact) return exact;

  const dash = key.indexOf("-");
  if (dash > 0) {
    const parent = GRID.get(key.slice(0, dash));
    if (parent) {
      return {
        ...parent,
        zone: key,
        ref: {
          ...parent.ref,
          note:
            `Resolved from sub-national zone "${key}" to country-level "${parent.zone}" — we hold ` +
            `country annual averages only, and sub-national grids can differ substantially. ` +
            `Sub-national resolution requires the live Electricity Maps adapter. ` +
            `${parent.ref.note ?? ""}`,
        },
      };
    }
  }

  return GRID.get(DEFAULT_ZONE)!;
}

export function resolveGrid(
  zone: string | undefined,
  signal: GridSignal = "average",
  opts: ResolveGridOptions = {},
): ResolvedGrid {
  const factor = lookup(zone);

  if (signal === "marginal") {
    if (factor.marginalGco2ePerKwh === undefined) {
      throw new MarginalSignalUnavailableError(
        factor.zone,
        factor.zone === "GLOBAL"
          ? "the global fallback has no meaningful marginal generator"
          : "fossil generation is too small a share of this grid to infer which unit follows load",
      );
    }
    if (factor.marginalEstimated && !opts.allowEstimatedMarginal) {
      throw new MarginalSignalUnavailableError(
        factor.zone,
        "only a fossil-mix-inferred estimate exists, not a measured MOER",
      );
    }
    return {
      gco2ePerKwh: factor.marginalGco2ePerKwh,
      low: factor.marginalLow ?? factor.marginalGco2ePerKwh,
      high: factor.marginalHigh ?? factor.marginalGco2ePerKwh,
      signal,
      estimated: factor.marginalEstimated,
      zone: factor.zone,
      ref: { ...factor.ref, id: `${factor.ref.id}.marginal` },
    };
  }

  return {
    gco2ePerKwh: factor.averageGco2ePerKwh,
    low: factor.averageLow,
    high: factor.averageHigh,
    signal,
    estimated: false,
    zone: factor.zone,
    ref: factor.ref,
  };
}

export { GRID_ZONES, GRID_SOURCE, GRID_RETRIEVED, MARGINAL_METHOD };

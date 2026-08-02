import { describe, it, expect } from "vitest";
import {
  GRID,
  GRID_ZONES,
  resolveGrid,
  resolveLand,
  GLOBAL_LAND,
  StaticGridProvider,
  ElectricityMapsProvider,
  WattTimeProvider,
  FallbackGridProvider,
  MarginalSignalUnavailableError,
  RESTATEMENTS,
} from "../src/index.js";
import { MIN_OBSERVATION_YEAR } from "../src/factors/grid-data.js";
import { CLOUD_REGIONS } from "../src/factors/cloud-regions.js";

const ESTIMATED = { allowEstimatedMarginal: true };

describe("zone coverage", () => {
  it("covers a broad set of countries", () => {
    expect(GRID_ZONES.length).toBeGreaterThan(150);
    for (const z of ["US", "GB", "FR", "DE", "IN", "BR", "JP", "AU", "ZA", "PL"]) {
      expect(GRID.has(z)).toBe(true);
    }
  });

  it("carries a plausible intensity for every zone", () => {
    for (const z of GRID_ZONES) {
      expect(z.avg).toBeGreaterThan(0);
      expect(z.avg).toBeLessThan(1500);
      expect(z.avgLow).toBeLessThanOrEqual(z.avg);
      expect(z.avgHigh).toBeGreaterThanOrEqual(z.avg);
    }
  });

  it("serves no observation older than the recency floor", () => {
    // Grids decarbonise fast enough that a 15-year-old intensity is not a stale
    // number, it is a wrong one. The ingest drops those rather than serving them;
    // they fall back to the global average, which is at least honest about being
    // an approximation. Western Sahara (2009) is the only one this currently cuts.
    for (const z of GRID_ZONES) {
      expect(z.year).toBeGreaterThanOrEqual(MIN_OBSERVATION_YEAR);
    }
  });

  it("orders known-clean and known-dirty grids correctly", () => {
    const clean = resolveGrid("FR").gco2ePerKwh;
    const mid = resolveGrid("GB").gco2ePerKwh;
    const dirty = resolveGrid("PL").gco2ePerKwh;
    expect(clean).toBeLessThan(mid);
    expect(mid).toBeLessThan(dirty);
  });
});

describe("marginal inference guardrails", () => {
  it("never infers a marginal below the fossil floor", () => {
    // The margin is set by a dispatchable fossil unit. Gas is the cleanest of
    // those at ~370 gCO2e/kWh even at the optimistic end, so an inferred marginal
    // materially below that would mean the inference is broken.
    for (const z of GRID_ZONES) {
      if (z.marginal === null) continue;
      expect(z.marginal).toBeGreaterThan(400);
      expect(z.marginal).toBeLessThan(1200);
    }
  });

  it("leaves marginal undefined wherever fossil generation is under the threshold", () => {
    for (const z of GRID_ZONES) {
      if (z.fossilShare !== null && z.fossilShare < 0.05) {
        expect(z.marginal).toBeNull();
      }
    }
  });

  it("widens the band where the fossil share is thin", () => {
    const thin = GRID_ZONES.filter(
      (z) => z.marginal !== null && z.fossilShare !== null && z.fossilShare < 0.2,
    );
    const thick = GRID_ZONES.filter(
      (z) => z.marginal !== null && z.fossilShare !== null && z.fossilShare > 0.5,
    );
    const width = (z: (typeof GRID_ZONES)[number]) =>
      (z.marginalHigh! - z.marginalLow!) / z.marginal!;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(thin.map(width))).toBeGreaterThan(avg(thick.map(width)));
  });
});

describe("static provider", () => {
  it("serves averages at tier 1 and flags that it is not time-resolved", async () => {
    const reading = await new StaticGridProvider().get({ zone: "GB" });
    expect(reading.tier).toBe(1);
    expect(reading.timeResolved).toBe(false);
    expect(reading.signal).toBe("average");
  });

  it("refuses an inferred marginal unless configured to allow it", async () => {
    await expect(
      new StaticGridProvider().get({ zone: "FR", signal: "marginal" }),
    ).rejects.toThrow(MarginalSignalUnavailableError);
    await expect(
      new StaticGridProvider(ESTIMATED).get({ zone: "FR", signal: "marginal" }),
    ).resolves.toMatchObject({ signal: "marginal", estimated: true });
  });
});

describe("Electricity Maps adapter", () => {
  // Recorded shape, not a live call. A suite that fails because a third party
  // rate-limited you teaches the team to ignore red builds.
  const fixture = (body: unknown, ok = true): typeof fetch =>
    (async () =>
      ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response) as typeof fetch;

  it("reads a time-resolved average at tier 3", async () => {
    const provider = new ElectricityMapsProvider({
      apiKey: "test",
      fetchImpl: fixture({ carbonIntensity: 142, datetime: "2026-07-31T09:00:00.000Z" }),
    });
    const reading = await provider.get({ zone: "GB", at: "2026-07-31T09:00:00.000Z" });
    expect(reading.gco2ePerKwh).toBe(142);
    expect(reading.tier).toBe(3);
    expect(reading.timeResolved).toBe(true);
    expect(reading.estimated).toBe(false);
    expect(reading.low).toBeLessThan(142);
    expect(reading.high).toBeGreaterThan(142);
  });

  it("refuses to serve a marginal request rather than passing off an average", async () => {
    // The single most common way a savings claim becomes indefensible.
    const provider = new ElectricityMapsProvider({
      apiKey: "test",
      fetchImpl: fixture({ carbonIntensity: 142 }),
    });
    await expect(provider.get({ zone: "GB", signal: "marginal" })).rejects.toThrow(/marginal/i);
  });

  it("surfaces an HTTP failure rather than returning a silent zero", async () => {
    const provider = new ElectricityMapsProvider({
      apiKey: "test",
      fetchImpl: fixture({}, false),
    });
    await expect(provider.get({ zone: "GB" })).rejects.toThrow(/503/);
  });
});

describe("WattTime adapter", () => {
  const fixture = (body: unknown): typeof fetch =>
    (async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response) as typeof fetch;

  it("converts lbs CO2e/MWh to gCO2e/kWh", async () => {
    // 1000 lbs/MWh = 453.59237 g/kWh.
    const provider = new WattTimeProvider({
      apiKey: "test",
      fetchImpl: fixture({
        data: [{ value: 1000, point_time: "2026-07-31T09:00:00Z" }],
        meta: { model: "2026-03-01" },
      }),
    });
    const reading = await provider.get({ zone: "CAISO_NORTH" });
    expect(reading.gco2ePerKwh).toBeCloseTo(453.59237, 4);
    expect(reading.signal).toBe("marginal");
    expect(reading.estimated).toBe(false);
    expect(reading.tier).toBe(4);
    expect(reading.ref.version).toBe("2026-03-01");
  });

  it("refuses to serve an inventory average", async () => {
    const provider = new WattTimeProvider({ apiKey: "test", fetchImpl: fixture({ data: [] }) });
    await expect(provider.get({ zone: "CAISO_NORTH", signal: "average" })).rejects.toThrow(
      /average/i,
    );
  });
});

describe("fallback chain", () => {
  const failing: typeof fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  it("degrades to the static table when a live provider is unavailable", async () => {
    const chain = new FallbackGridProvider([
      new ElectricityMapsProvider({ apiKey: "test", fetchImpl: failing }),
      new StaticGridProvider(),
    ]);
    const reading = await chain.get({ zone: "GB" });
    expect(reading.tier).toBe(1);
    expect(reading.gco2ePerKwh).toBe(resolveGrid("GB").gco2ePerKwh);
  });

  it("reports the best tier any member can reach", () => {
    const chain = new FallbackGridProvider([
      new WattTimeProvider({ apiKey: "t", fetchImpl: failing }),
      new StaticGridProvider(),
    ]);
    expect(chain.maxTier).toBe(4);
  });

  it("still refuses a marginal request the whole chain cannot honestly serve", async () => {
    // Degrading to a worse-but-available number is fine. Degrading to the wrong
    // *kind* of number is not.
    const chain = new FallbackGridProvider([
      new ElectricityMapsProvider({ apiKey: "t", fetchImpl: failing }),
      new StaticGridProvider(),
    ]);
    await expect(chain.get({ zone: "FR", signal: "marginal" })).rejects.toThrow(
      MarginalSignalUnavailableError,
    );
  });
});

describe("grid restatement", () => {
  it("records the move to Ember-sourced zones", () => {
    const entry = RESTATEMENTS.forFactor("grid.*")[0];
    expect(entry).toBeDefined();
    expect(entry!.reason).toContain("Ember");
  });
});

describe("land — the fourth resource", () => {
  it("derives land intensity for nearly every zone from its generation mix", () => {
    const withLand = GRID_ZONES.filter((z) => z.landCm2PerKwh !== null);
    expect(withLand.length).toBeGreaterThan(180);
    for (const z of withLand) {
      expect(z.landLow!).toBeLessThan(z.landCm2PerKwh!);
      expect(z.landHigh!).toBeGreaterThan(z.landCm2PerKwh!);
    }
  });

  it("reports renewable-heavy grids as MORE land-intensive than coal-heavy ones", () => {
    // The uncomfortable result, asserted deliberately so nobody "fixes" it later.
    // Wind and solar occupy far more area per kWh than a coal plant does. Great
    // Britain emits a third of South Africa's carbon and uses several times the
    // land. A metric that only ever flattered the clean option would not be a
    // measurement, and this test exists to stop that drift.
    const gb = resolveLand("GB");
    const za = resolveLand("ZA");
    expect(gb.cm2PerKwh).toBeGreaterThan(za.cm2PerKwh * 3);

    const gbCarbon = resolveGrid("GB").gco2ePerKwh;
    const zaCarbon = resolveGrid("ZA").gco2ePerKwh;
    expect(gbCarbon).toBeLessThan(zaCarbon / 2);
  });

  it("puts nuclear-heavy France far below hydro-heavy Norway on land", () => {
    // Nuclear is the least land-intensive source by an order of magnitude;
    // reservoir hydro is among the most.
    expect(resolveLand("FR").cm2PerKwh).toBeLessThan(resolveLand("NO").cm2PerKwh);
  });

  it("falls back to a wide global band where no generation mix exists", () => {
    const unknown = resolveLand("NOT-A-ZONE");
    expect(unknown.cm2PerKwh).toBe(GLOBAL_LAND.value);
    expect(unknown.high / unknown.low).toBeGreaterThan(5);
  });

  it("carries a band wide enough to span footprint and spacing", () => {
    // Wind is ~92x between direct footprint and footprint-plus-spacing. A narrow
    // band here would mean the boundary problem had been quietly averaged away.
    for (const z of GRID_ZONES.filter((x) => x.landCm2PerKwh !== null).slice(0, 40)) {
      expect(z.landHigh! / z.landLow!).toBeGreaterThan(1.5);
    }
  });
});

/*
 * Region resolution.
 *
 * These exist because the library silently answered "475 gCO2e/kWh" for every
 * cloud region code anyone actually passes it. `us-central1` read as the global
 * average rather than the US grid, `europe-west1` as the global average rather
 * than Belgium, and nothing in the output distinguished those from a located
 * figure. The bug was invisible precisely because the wrong answer is a
 * plausible number.
 */
describe("region resolution", () => {
  it("maps cloud region codes to the country they sit in", () => {
    expect(resolveGrid("us-central1").gco2ePerKwh).toBe(resolveGrid("US").gco2ePerKwh);
    expect(resolveGrid("europe-west9").gco2ePerKwh).toBe(resolveGrid("FR").gco2ePerKwh);
    expect(resolveGrid("eu-west-1").gco2ePerKwh).toBe(resolveGrid("IE").gco2ePerKwh);
    expect(resolveGrid("westeurope").gco2ePerKwh).toBe(resolveGrid("NL").gco2ePerKwh);
  });

  it("does not let the sub-national split capture dashed cloud regions", () => {
    // "eu-west-1" splitting on the first dash yields "EU", which is not a zone;
    // the danger was "us-east-1" resolving via "US" and looking correct while
    // "eu-west-1" quietly did the same thing and was not.
    expect(resolveGrid("eu-west-1").gco2ePerKwh).not.toBe(resolveGrid("US").gco2ePerKwh);
    expect(resolveGrid("eu-west-3").gco2ePerKwh).toBe(resolveGrid("FR").gco2ePerKwh);
  });

  it("is case-insensitive", () => {
    expect(resolveGrid("fr").gco2ePerKwh).toBe(resolveGrid("FR").gco2ePerKwh);
    expect(resolveGrid("us-CENTRAL1").gco2ePerKwh).toBe(resolveGrid("US").gco2ePerKwh);
  });

  it("still resolves sub-national zones to their country, with the note", () => {
    expect(resolveGrid("US-CAISO").gco2ePerKwh).toBe(resolveGrid("US").gco2ePerKwh);
    expect(resolveGrid("US-CAISO").ref.note).toContain("sub-national");
  });

  it("records that an unrecognised region fell back, rather than falling back silently", () => {
    const bogus = resolveGrid("not-a-place");
    expect(bogus.gco2ePerKwh).toBe(resolveGrid("GLOBAL").gco2ePerKwh);
    expect(bogus.ref.note).toContain("global average was used");
    expect(bogus.ref.note).toContain("not-a-place");
  });

  it("distinguishes no region supplied from a region it could not place", () => {
    expect(resolveGrid(undefined).ref.note).toContain("No region was supplied");
    expect(resolveGrid("").ref.note).toContain("No region was supplied");
    expect(resolveGrid("   ").ref.note).toContain("No region was supplied");
    expect(resolveGrid("zzz").ref.note).toContain("not recognised");
  });

  it("annotates a cloud-mapped factor so the pack can disclose the coarsening", () => {
    expect(resolveGrid("us-central1").ref.note).toContain("from cloud region");
  });

  it("every mapped cloud region points at a zone that exists", () => {
    for (const [region, zone] of CLOUD_REGIONS) {
      expect(GRID.get(zone), `${region} -> ${zone}`).toBeDefined();
    }
  });
});

describe("Vercel regions", () => {
  it("resolves the codes Vercel puts in VERCEL_REGION", () => {
    expect(resolveGrid("iad1").gco2ePerKwh).toBe(resolveGrid("US").gco2ePerKwh);
    expect(resolveGrid("cdg1").gco2ePerKwh).toBe(resolveGrid("FR").gco2ePerKwh);
    expect(resolveGrid("dub1").gco2ePerKwh).toBe(resolveGrid("IE").gco2ePerKwh);
    expect(resolveGrid("syd1").gco2ePerKwh).toBe(resolveGrid("AU").gco2ePerKwh);
  });

  it("does not send them to the global average", () => {
    for (const r of ["iad1", "fra1", "hnd1", "gru1", "lhr1"]) {
      expect(resolveGrid(r).zone, r).not.toBe("GLOBAL");
    }
  });
});

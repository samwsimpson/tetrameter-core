import { describe, it, expect } from "vitest";
import {
  quantity,
  exact,
  scale,
  scaleBy,
  sum,
  bandWidth,
  isWideBand,
  formatQuantity,
} from "../src/quantity.js";

describe("quantity", () => {
  it("rejects bounds that do not bracket the value", () => {
    expect(() => quantity({ value: 10, low: 12, high: 20, unit: "kWh", tier: 2 })).toThrow(
      RangeError,
    );
    expect(() => quantity({ value: 10, low: 5, high: 8, unit: "kWh", tier: 2 })).toThrow(RangeError);
  });

  it("defaults to a zero band only when no bounds are given", () => {
    const q = quantity({ value: 5, unit: "USD", tier: 4 });
    expect(q.low).toBe(5);
    expect(q.high).toBe(5);
    expect(bandWidth(q)).toBe(0);
  });

  it("treats exact quantities as tier 4 with no band", () => {
    const q = exact(1.25, "USD");
    expect(q.tier).toBe(4);
    expect(bandWidth(q)).toBe(0);
  });

  it("propagates bounds multiplicatively through scale", () => {
    const energy = quantity({ value: 2, low: 1, high: 4, unit: "kWh", tier: 2 });
    const intensity = quantity({
      value: 100,
      low: 50,
      high: 200,
      unit: "gCO2e/kWh",
      tier: 1,
    });
    const carbon = scale(energy, intensity, "gCO2e");

    expect(carbon.value).toBe(200);
    expect(carbon.low).toBe(50);
    expect(carbon.high).toBe(800);
  });

  it("inherits the weaker tier when combining — a chain is only as good as its worst link", () => {
    const strong = quantity({ value: 1, low: 1, high: 1, unit: "kWh", tier: 4 });
    const weak = quantity({ value: 2, low: 1, high: 3, unit: "gCO2e/kWh", tier: 1 });
    expect(scale(strong, weak, "gCO2e").tier).toBe(1);
  });

  it("scales bands with an exact scalar", () => {
    const q = quantity({ value: 2, low: 1, high: 3, unit: "kWh", tier: 2 });
    const scaled = scaleBy(q, 10);
    expect(scaled.value).toBe(20);
    expect(scaled.low).toBe(10);
    expect(scaled.high).toBe(30);
  });

  it("sums bounds conservatively and keeps the weakest tier", () => {
    const a = quantity({ value: 1, low: 0.5, high: 2, unit: "gCO2e", tier: 3 });
    const b = quantity({ value: 2, low: 1, high: 5, unit: "gCO2e", tier: 1 });
    const total = sum([a, b], "gCO2e");

    expect(total.value).toBe(3);
    expect(total.low).toBe(1.5);
    expect(total.high).toBe(7);
    expect(total.tier).toBe(1);
  });

  it("refuses to sum mismatched units", () => {
    const a = quantity({ value: 1, unit: "gCO2e", tier: 4 });
    const b = quantity({ value: 1, unit: "L", tier: 4 });
    expect(() => sum([a, b], "gCO2e")).toThrow(TypeError);
  });

  it("deduplicates sources by id and version", () => {
    const ref = {
      id: "grid.GLOBAL",
      kind: "grid-intensity" as const,
      version: "2026.07.0",
      source: "test",
      retrieved: "2026-07-31",
    };
    const a = quantity({ value: 1, unit: "gCO2e", tier: 2, sources: [ref] });
    const b = quantity({ value: 1, unit: "gCO2e", tier: 2, sources: [ref] });
    expect(sum([a, b], "gCO2e").sources).toHaveLength(1);
  });
});

describe("uncertainty disclosure", () => {
  it("flags a band wider than half the central value", () => {
    const wide = quantity({ value: 10, low: 4, high: 20, unit: "gCO2e", tier: 1 });
    const tight = quantity({ value: 10, low: 9.6, high: 10.4, unit: "gCO2e", tier: 3 });
    expect(isWideBand(wide)).toBe(true);
    expect(isWideBand(tight)).toBe(false);
  });

  it("renders a range rather than a point value when the band is wide", () => {
    const wide = quantity({ value: 10, low: 4, high: 20, unit: "gCO2e", tier: 1 });
    expect(formatQuantity(wide)).toBe("4–20 gCO2e");
  });

  it("renders a point value only when the band is tight", () => {
    const tight = quantity({ value: 10, low: 9.6, high: 10.4, unit: "gCO2e", tier: 3 });
    expect(formatQuantity(tight)).toBe("10 gCO2e");
  });

  it("does not divide by zero on a zero quantity", () => {
    const zero = quantity({ value: 0, unit: "gCO2e", tier: 4 });
    expect(bandWidth(zero)).toBe(0);
    expect(isWideBand(zero)).toBe(false);
  });
});

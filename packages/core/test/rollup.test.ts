import { describe, it, expect } from "vitest";
import {
  rollup,
  rollupTotal,
  efficiencyByPeriod,
  periodKey,
  MIXED,
  UNATTRIBUTED,
} from "../src/index.js";
import type { CallRecord, TraceRecord } from "../src/index.js";

function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "c",
    timestamp: "2026-07-15T10:00:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-5",
    region: "GB",
    inputTokens: 1000,
    outputTokens: 400,
    ...over,
  };
}

function trace(id: string, calls: CallRecord[], outcome = 1): TraceRecord {
  return { traceId: id, calls, outcome: "ticket resolved", outcomeCount: outcome };
}

const CORPUS: TraceRecord[] = [
  trace("t1", [
    call({ id: "a", team: "support", feature: "triage", customer: "acme" }),
    call({ id: "b", team: "support", feature: "triage", customer: "acme", outputTokens: 900 }),
  ]),
  trace("t2", [call({ id: "c", team: "support", feature: "triage", customer: "globex" })]),
  trace("t3", [
    call({ id: "d", team: "search", feature: "rerank", customer: "acme", model: "claude-haiku-4-5" }),
  ]),
];

describe("period bucketing", () => {
  it("buckets in UTC so a report does not shift with the reader", () => {
    expect(periodKey("2026-07-15T23:30:00.000Z", "day")).toBe("2026-07-15");
    expect(periodKey("2026-07-15T10:00:00.000Z", "month")).toBe("2026-07");
    expect(periodKey("2026-07-15T10:00:00.000Z", "quarter")).toBe("2026-Q3");
    expect(periodKey("2026-01-15T10:00:00.000Z", "quarter")).toBe("2026-Q1");
    expect(periodKey("2026-12-31T10:00:00.000Z", "quarter")).toBe("2026-Q4");
    expect(periodKey("2026-07-15T10:00:00.000Z", "year")).toBe("2026");
  });
});

describe("rollup", () => {
  it("totals everything into one group when no dimension is given", () => {
    const total = rollupTotal(CORPUS);
    expect(total.traces).toBe(3);
    expect(total.calls).toBe(4);
    expect(total.outcomes).toBe(3);
    expect(total.footprint.carbon.value).toBeGreaterThan(0);
  });

  it("groups by customer — the attribution nobody else reaches", () => {
    const byCustomer = rollup(CORPUS, { by: ["customer"] });
    const acme = byCustomer.find((g) => g.key["customer"] === "acme");
    const globex = byCustomer.find((g) => g.key["customer"] === "globex");
    expect(acme?.traces).toBe(2);
    expect(globex?.traces).toBe(1);
  });

  it("orders groups by carbon so the first row is the thing worth acting on", () => {
    const groups = rollup(CORPUS, { by: ["team"] });
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1]!.footprint.carbon.value).toBeGreaterThanOrEqual(
        groups[i]!.footprint.carbon.value,
      );
    }
  });

  it("conserves totals across a breakdown", () => {
    // If a breakdown does not add back up to the total, the report is wrong.
    const total = rollupTotal(CORPUS);
    const byTeam = rollup(CORPUS, { by: ["team"] });
    const summed = byTeam.reduce((a, g) => a + g.footprint.carbon.value, 0);
    expect(summed).toBeCloseTo(total.footprint.carbon.value, 10);
  });

  it("flags a trace whose calls disagree rather than silently picking one", () => {
    // `team` is still trace-level. `feature` moved to call level once the first
    // real capture proved a trace can legitimately span two features.
    const mixed = rollup([trace("t9", [call({ id: "x", team: "a" }), call({ id: "y", team: "b" })])], {
      by: ["team"],
    });
    expect(mixed[0]?.key["team"]).toBe(MIXED);
  });

  it("marks missing attribution rather than dropping the trace", () => {
    const groups = rollup([trace("t8", [call({ id: "z" })])], { by: ["customer"] });
    expect(groups[0]?.key["customer"]).toBe(UNATTRIBUTED);
    expect(groups[0]?.traces).toBe(1);
  });

  it("aggregates model per call, because a trace legitimately spans models", () => {
    // An agent running Haiku for intermediate turns and Sonnet for the final
    // answer has no single model. Trace-level grouping returned "(mixed)" for
    // every row and produced a breakdown that told you nothing.
    const mixedModel = trace("m", [
      call({ id: "1", model: "claude-haiku-4-5" }),
      call({ id: "2", model: "claude-haiku-4-5" }),
      call({ id: "3", model: "claude-sonnet-5" }),
    ]);
    const byModel = rollup([mixedModel], { by: ["model"] });

    expect(byModel.map((g) => g.key["model"]).sort()).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-5",
    ]);
    expect(byModel.every((g) => g.key["model"] !== MIXED)).toBe(true);
    expect(byModel.find((g) => g.key["model"] === "claude-haiku-4-5")?.calls).toBe(2);
  });

  it("does not attribute outcomes or SCI to a call-level group", () => {
    // An outcome belongs to the whole trace. Splitting it across the models that
    // produced it would invent a denominator.
    const byModel = rollup(CORPUS, { by: ["model"] });
    for (const g of byModel) {
      expect(g.outcomes).toBe(0);
      expect(g.sci).toBeUndefined();
    }
  });

  it("conserves carbon across a call-level breakdown too", () => {
    const total = rollupTotal(CORPUS);
    const summed = rollup(CORPUS, { by: ["model"] }).reduce(
      (a, g) => a + g.footprint.carbon.value,
      0,
    );
    expect(summed).toBeCloseTo(total.footprint.carbon.value, 10);
  });

  it("keeps team and customer at trace level so SCI stays meaningful", () => {
    // `feature` is deliberately absent: it is per-call now, so it carries no
    // outcomes. See CALL_LEVEL_DIMENSIONS for why the real capture forced that.
    for (const dim of ["team", "customer"] as const) {
      const groups = rollup(CORPUS, { by: [dim] });
      expect(groups.some((g) => g.outcomes > 0)).toBe(true);
      expect(groups.some((g) => g.sci !== undefined)).toBe(true);
    }
  });

  it("supports multi-dimensional grouping", () => {
    const groups = rollup(CORPUS, { by: ["team", "customer"] });
    expect(groups.length).toBe(3);
    expect(groups.every((g) => "team" in g.key && "customer" in g.key)).toBe(true);
  });

  it("buckets by period", () => {
    const groups = rollup(
      [
        trace("j", [call({ id: "1", timestamp: "2026-06-02T00:00:00.000Z" })]),
        trace("k", [call({ id: "2", timestamp: "2026-07-02T00:00:00.000Z" })]),
      ],
      { period: "month" },
    );
    expect(groups.map((g) => g.key["period"]).sort()).toEqual(["2026-06", "2026-07"]);
  });
});

describe("tier distribution", () => {
  it("reports carbon-weighted share alongside count", () => {
    // A report can be mostly tier 2 by count while most of its emissions sit at
    // tier 1. The carbon-weighted number is the one an auditor should read.
    const t = rollupTotal(CORPUS).tierMix;
    const countSum = ([1, 2, 3, 4] as const).reduce((a, k) => a + t.shares[k], 0);
    const carbonSum = ([1, 2, 3, 4] as const).reduce((a, k) => a + t.carbonShares[k], 0);
    expect(countSum).toBeCloseTo(1, 6);
    expect(carbonSum).toBeCloseTo(1, 6);
  });

  it("reports the weakest tier present", () => {
    expect(rollupTotal(CORPUS).tierMix.weakest).toBe(1);
  });

  it("does not divide by zero on an empty corpus", () => {
    const empty = rollupTotal([]);
    expect(empty.traces).toBe(0);
    expect(empty.footprint.carbon.value).toBe(0);
  });
});

describe("efficiency by period", () => {
  it("reports gCO2e per outcome over time, ascending", () => {
    const points = efficiencyByPeriod(
      [
        trace("a", [call({ id: "1", timestamp: "2026-07-01T00:00:00.000Z", outputTokens: 4000 })], 1),
        trace("b", [call({ id: "2", timestamp: "2026-06-01T00:00:00.000Z", outputTokens: 8000 })], 1),
      ],
      "month",
    );
    expect(points.map((p) => p.period)).toEqual(["2026-06", "2026-07"]);
    // Half the tokens for the same single outcome — efficiency improved.
    expect(points[1]!.gco2ePerOutcome.value).toBeLessThan(points[0]!.gco2ePerOutcome.value);
  });

  it("omits periods with no recorded outcomes rather than dividing by zero", () => {
    const points = efficiencyByPeriod(
      [{ traceId: "x", calls: [call({ id: "1" })], outcomeCount: 0 }],
      "month",
    );
    expect(points).toHaveLength(0);
  });
});

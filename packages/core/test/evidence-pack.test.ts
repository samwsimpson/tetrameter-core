import { describe, it, expect } from "vitest";
import { buildEvidencePack, renderEvidencePack, FACTOR_SET_VERSION } from "../src/index.js";
import type { CallRecord, TraceRecord, EvidencePackOptions } from "../src/index.js";

function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "c",
    timestamp: "2026-07-15T10:00:00.000Z",
    provider: "anthropic",
    model: "claude-sonnet-5",
    region: "GB",
    inputTokens: 1200,
    outputTokens: 400,
    team: "support",
    feature: "triage",
    customer: "acme",
    ...over,
  };
}

const TRACES: TraceRecord[] = [
  {
    traceId: "t1",
    outcome: "ticket resolved",
    outcomeCount: 1,
    calls: [call({ id: "a" }), call({ id: "b", outputTokens: 900 })],
  },
  {
    traceId: "t2",
    outcome: "ticket resolved",
    outcomeCount: 1,
    calls: [call({ id: "c", customer: "globex", model: "o3-mini", reasoningTokens: 5000 })],
  },
];

const OPTS: EvidencePackOptions = {
  entity: "KumoKodo Ltd",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  functionalUnit: "support ticket resolved",
};

describe("evidence pack structure", () => {
  it("records the factor set version so the report is reproducible", () => {
    // "Computed against factor set X" is the whole reproducibility claim.
    expect(buildEvidencePack(TRACES, OPTS).meta.factorSetVersion).toBe(FACTOR_SET_VERSION);
  });

  it("reports scope, totals and an SCI per functional unit", () => {
    const pack = buildEvidencePack(TRACES, OPTS);
    expect(pack.scope.traces).toBe(2);
    expect(pack.scope.calls).toBe(3);
    expect(pack.scope.outcomes).toBe(2);
    expect(pack.totals.carbon.value).toBeGreaterThan(0);
    expect(pack.totals.sci?.unit).toBe("gCO2e/unit");
  });

  it("includes every breakdown requested", () => {
    const pack = buildEvidencePack(TRACES, { ...OPTS, breakdowns: ["customer", "model"] });
    expect(Object.keys(pack.breakdowns).sort()).toEqual(["customer", "model"]);
    expect(pack.breakdowns["customer"]?.length).toBe(2);
  });

  it("registers every factor used, with version and retrieval date", () => {
    // This is what emission-factor testing under ISAE 3410 actually looks at.
    const pack = buildEvidencePack(TRACES, OPTS);
    expect(pack.factorRegister.length).toBeGreaterThan(3);
    for (const f of pack.factorRegister) {
      expect(f.version).toBeTruthy();
      expect(f.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}/);
      expect(f.source.length).toBeGreaterThan(5);
    }
    for (const kind of ["model-energy", "grid-intensity", "pricing", "overhead"]) {
      expect(pack.factorRegister.some((f) => f.kind === kind)).toBe(true);
    }
  });

  it("carries the restatement log", () => {
    expect(buildEvidencePack(TRACES, OPTS).restatements.length).toBeGreaterThan(0);
  });
});

describe("the pack criticises itself", () => {
  it("discloses when most emissions rest on tier 1 evidence", () => {
    const pack = buildEvidencePack(TRACES, OPTS);
    expect(pack.caveats.some((c) => /Tier 1/.test(c))).toBe(true);
  });

  it("states that no figure rests on measured energy", () => {
    const pack = buildEvidencePack(TRACES, OPTS);
    expect(pack.caveats.some((c) => /measured energy/i.test(c))).toBe(true);
  });

  it("warns that an average-signal report cannot substantiate avoided emissions", () => {
    // The most consequential misuse available: an inventory figure presented as
    // a saving. The pack says so without anyone remembering to write it.
    const pack = buildEvidencePack(TRACES, OPTS);
    expect(pack.caveats.some((c) => /avoided emissions/i.test(c))).toBe(true);
  });

  it("flags an inferred marginal when the report is built on one", () => {
    const pack = buildEvidencePack(TRACES, {
      ...OPTS,
      signal: "marginal",
      allowEstimatedMarginal: true,
    });
    expect(pack.meta.marginalEstimated).toBe(true);
    expect(pack.caveats.some((c) => /inferred/i.test(c))).toBe(true);
    expect(pack.caveats.some((c) => /avoided emissions/i.test(c))).toBe(false);
  });

  it("discloses tokens billed but never surfaced to a user", () => {
    const pack = buildEvidencePack(TRACES, OPTS);
    expect(pack.scope.invisibleTokens).toBeGreaterThan(0);
    expect(pack.caveats.some((c) => /never surfaced/i.test(c))).toBe(true);
  });

  it("notes the sub-national downgrade when one occurred", () => {
    const pack = buildEvidencePack(
      [{ traceId: "t", outcomeCount: 1, calls: [call({ region: "US-CAISO" })] }],
      OPTS,
    );
    expect(pack.caveats.some((c) => /sub-national/i.test(c))).toBe(true);
  });

  it("always says something — a report with no stated limitations is a warning sign", () => {
    expect(buildEvidencePack(TRACES, OPTS).caveats.length).toBeGreaterThan(2);
  });
});

describe("rendered markdown", () => {
  const md = renderEvidencePack(buildEvidencePack(TRACES, OPTS));

  it("names the entity, period and factor set up front", () => {
    expect(md).toContain("KumoKodo Ltd");
    expect(md).toContain("2026-07-01");
    expect(md).toContain(FACTOR_SET_VERSION);
  });

  it("classifies the disclosure correctly for a filing", () => {
    expect(md).toContain("Scope 3, Category 1");
  });

  it("contains every section an assurance provider tests", () => {
    for (const heading of [
      "## 1. Scope",
      "## 2. Totals",
      "## 3. Evidence tiers",
      "## 4. Breakdowns",
      "## 5. Methodology and boundaries",
      "## 6. Limitations",
      "## 7. Factor register",
      "## 8. Restatements",
    ]) {
      expect(md).toContain(heading);
    }
  });

  it("states what is out of scope, not just what is in", () => {
    expect(md).toContain("Excluded");
    expect(md).toMatch(/training/i);
  });

  it("labels a per-call breakdown as calls, not traces", () => {
    // Calling them traces would overstate the unit and imply an outcome can be
    // attributed to a single model.
    const byModel = renderEvidencePack(
      buildEvidencePack(TRACES, { ...OPTS, breakdowns: ["model"] }),
    );
    expect(byModel).toContain("| model | calls |");
    expect(byModel).toContain("varies within a trace");
  });

  it("labels a trace-level breakdown as traces", () => {
    const byCustomer = renderEvidencePack(
      buildEvidencePack(TRACES, { ...OPTS, breakdowns: ["customer"] }),
    );
    expect(byCustomer).toContain("| customer | traces |");
  });

  it("renders ranges rather than false precision", () => {
    // formatQuantity widens to a range when the band is wide; the report has no
    // business overriding that to look more confident than it is.
    expect(md).toMatch(/\d–\d/);
  });

  it("escapes pipes so a source string cannot break the table", () => {
    const rows = md.split("\n").filter((l) => l.startsWith("| `"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.split("|").length).toBeGreaterThan(4);
    }
  });
});

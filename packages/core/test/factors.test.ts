import { describe, it, expect } from "vitest";
import {
  callEnergy,
  classifyModel,
  computeCall,
  resolveModelEnergy,
  MODEL_ENERGY,
  MLENERGY_ROWS,
  MLENERGY_CLASS,
  RESTATEMENTS,
  FACTOR_SET_VERSION,
  HOST_OVERHEAD,
  PUE,
} from "../src/index.js";
import type { CallRecord } from "../src/index.js";

function call(over: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "c1",
    timestamp: "2026-07-31T10:00:00.000Z",
    provider: "test",
    model: "claude-sonnet-5",
    inputTokens: 0,
    outputTokens: 1000,
    ...over,
  };
}

describe("ML.ENERGY ingest", () => {
  it("loaded measured rows for both regimes", () => {
    expect(MLENERGY_ROWS.length).toBeGreaterThan(20);
    expect(MLENERGY_ROWS.some((r) => r.regime === "chat")).toBe(true);
    expect(MLENERGY_ROWS.some((r) => r.regime === "reasoning")).toBe(true);
  });

  it("every row carries a real percentile band from multiple serving configurations", () => {
    for (const row of MLENERGY_ROWS) {
      expect(row.configs).toBeGreaterThan(1);
      expect(row.lo).toBeLessThan(row.mid);
      expect(row.mid).toBeLessThan(row.hi);
    }
  });

  it("captures the serving-configuration spread that an API customer cannot see", () => {
    // The headline finding from the data: the same model varies several-fold per
    // token purely with batch size and parallelism. If this ever collapses to a
    // narrow band, the ingest has averaged away the thing that matters.
    const spreads = MLENERGY_ROWS.map((r) => r.hi / r.lo);
    const median = spreads.sort((a, b) => a - b)[Math.floor(spreads.length / 2)]!;
    expect(median).toBeGreaterThan(2);
  });

  it("resolves a benchmarked model to tier 2", () => {
    const resolved = resolveModelEnergy("meta-llama/llama-3.1-8b-instruct");
    expect(resolved.tier).toBe(2);
    expect(resolved.factor.ref.source).toContain("ML.ENERGY");
  });

  it("resolves short aliases people actually pass", () => {
    expect(resolveModelEnergy("llama-3.1-8b-instruct").tier).toBe(2);
    expect(resolveModelEnergy("qwen3-32b").tier).toBe(2);
    expect(resolveModelEnergy("deepseek-r1", "mid", true).tier).toBe(2);
  });

  it("keeps commercial API models at tier 1, because nobody publishes their internals", () => {
    // Provider transparency is the binding constraint. Claiming tier 2 here would
    // be exactly the overreach this library exists to prevent.
    for (const model of ["claude-sonnet-5", "gpt-5", "gemini-3-pro", "claude-opus-5"]) {
      expect(resolveModelEnergy(model).tier).toBe(1);
    }
  });

  it("reads a negated capability as its absence, not its presence", () => {
    // Found in the first real customer fleet, not in review. The anchoring rule
    // was satisfied — `-reasoning` sits behind a separator — and the model still
    // classified as reasoning, putting a mid-class model on the reasoning energy
    // curve and overstating it roughly threefold.
    //
    // Overstating is not the safe direction. Providers name models by what they
    // are not often enough that this will recur, so it is pinned here.
    expect(classifyModel("grok-4-1-fast-non-reasoning")).toBe("mid");
    expect(classifyModel("claude-sonnet-4-5-non-thinking")).toBe("mid");
    expect(classifyModel("gpt-5-no-reasoning")).toBe("mid");

    // The un-negated forms must still classify, or the fix traded one silent
    // error for another.
    expect(classifyModel("grok-4-1-fast-reasoning")).toBe("reasoning");
    expect(classifyModel("claude-sonnet-4-5-thinking")).toBe("reasoning");
    expect(classifyModel("o3-mini")).toBe("reasoning");
    expect(classifyModel("deepseek-r1")).toBe("reasoning");
  });

  it("selects the long-context measurement when a call reported reasoning tokens", () => {
    // The same model costs more per token over a long context.
    const chat = resolveModelEnergy("qwen/qwen3-14b", "mid", false);
    const reasoning = resolveModelEnergy("qwen/qwen3-14b", "mid", true);
    expect(reasoning.factor.whPer1kOutput).toBeGreaterThan(chat.factor.whPer1kOutput * 2);
    expect(MODEL_ENERGY.has("qwen/qwen3-14b#reasoning")).toBe(true);
  });

  it("orders class averages by model size", () => {
    expect(MLENERGY_CLASS.small.mid).toBeLessThan(MLENERGY_CLASS.mid.mid);
    expect(MLENERGY_CLASS.mid.mid).toBeLessThan(MLENERGY_CLASS.large.mid);
  });
});

describe("reconciliation against the only first-party disclosure", () => {
  /**
   * Google published a median Gemini text prompt at 0.24 Wh, measured on May 2025
   * production data and inclusive of cooling, idle reserve, CPU/RAM and datacentre
   * overhead. It is the only figure of its kind, and it is the one external check
   * available on our whole bottom-up chain.
   *
   * If this drifts, either an upstream factor moved or we introduced an error —
   * and either way it is a restatement event, not something to quietly retune.
   */
  it("reproduces Google's published median prompt within a factor of two", () => {
    const GOOGLE_MEDIAN_WH = 0.24;
    const BENCHMARK_MEDIAN_OUTPUT_TOKENS = 634;

    const energy = callEnergy(
      call({ model: "gemini-3-pro", inputTokens: 0, outputTokens: BENCHMARK_MEDIAN_OUTPUT_TOKENS }),
    );
    const wh = energy.value * 1000;

    expect(wh).toBeGreaterThan(GOOGLE_MEDIAN_WH / 2);
    expect(wh).toBeLessThan(GOOGLE_MEDIAN_WH * 2);
  });

  it("brackets Google's figure inside the reported uncertainty band", () => {
    const energy = callEnergy(call({ model: "gemini-3-pro", inputTokens: 0, outputTokens: 634 }));
    expect(energy.low * 1000).toBeLessThan(0.24);
    expect(energy.high * 1000).toBeGreaterThan(0.24);
  });

  it("keeps the host-overhead derivation honest", () => {
    // Documented in overhead.ts: 0.24 / 0.0989 / 1.09 ≈ 2.23. If someone edits the
    // value without redoing the arithmetic, this fails.
    const gpuWhPerRequest = (MLENERGY_CLASS.mid.mid / 1000) * 634;
    const impliedTotalRatio = 0.24 / gpuWhPerRequest;
    expect(HOST_OVERHEAD.value).toBeCloseTo(impliedTotalRatio / 1.09, 1);
    expect(HOST_OVERHEAD.low).toBeLessThan(HOST_OVERHEAD.value);
    expect(HOST_OVERHEAD.high).toBeGreaterThan(HOST_OVERHEAD.value);
    expect(PUE.value).toBeGreaterThan(1);
  });

  it("applies host overhead and PUE multiplicatively, not once", () => {
    const energy = callEnergy(call({ model: "qwen3-8b", outputTokens: 1000, inputTokens: 0 }));
    const factor = resolveModelEnergy("qwen3-8b").factor;
    const acceleratorOnlyKwh = factor.whPer1kOutput / 1000;
    expect(energy.value).toBeCloseTo(acceleratorOnlyKwh * HOST_OVERHEAD.value * PUE.value, 10);
  });
});

describe("restatement log", () => {
  it("documents every factor change shipped in this version", () => {
    expect(RESTATEMENTS.entries.length).toBeGreaterThan(0);
    for (const entry of RESTATEMENTS.entries) {
      expect(entry.toVersion).toMatch(/^2026\.08\./);
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.applied).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("records the materiality of the ML.ENERGY switch", () => {
    const entry = RESTATEMENTS.forFactor("model.class.*")[0];
    expect(entry).toBeDefined();
    expect(entry!.fromVersion).toBe("2026.07.0");
    expect(entry!.materialityEstimate).toBeLessThan(0);
    expect(entry!.reason).toContain("ML.ENERGY");
  });

  it("can answer what a re-filed report would have to disclose", () => {
    expect(RESTATEMENTS.since("2026-07-01").length).toBeGreaterThan(0);
    expect(RESTATEMENTS.since("2027-01-01")).toHaveLength(0);
  });
});

describe("regression guards on the compute chain", () => {
  it("still charges reasoning tokens more than plain output on the same model", () => {
    const plain = callEnergy(call({ model: "qwen3-14b", outputTokens: 5000 }));
    const thinking = callEnergy(call({ model: "qwen3-14b", outputTokens: 100, reasoningTokens: 4900 }));
    expect(thinking.value).toBeGreaterThan(plain.value);
  });

  it("keeps a measured-energy call at tier 3 for energy and tier 1 for carbon", () => {
    const f = computeCall(call({ measuredWh: 0.5 }));
    expect(f.energy.tier).toBe(3);
    expect(f.carbon.tier).toBe(1);
  });

  it("attaches the accelerator, host and facility factors to the energy figure", () => {
    const ids = callEnergy(call()).sources.map((s) => s.id);
    expect(ids).toContain("overhead.host");
    expect(ids).toContain("overhead.pue");
    expect(ids.some((id) => id.startsWith("model."))).toBe(true);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import {
  Collector,
  MemorySink,
  MultiSink,
  JsonlFileSink,
  withTrace,
  sanitize,
  normalizeModelId,
  sameModel,
  recordAiSdkResult,
  instrumentGenerateText,
  recordAnthropicMessage,
  extractUsage,
  modelFromUrl,
  configure,
  record,
  _reset,
  toTraces,
  instrumentedFetch,
  register,
  traceRequest,
  setTraceMeta,
} from "../src/index.js";
import type { Sink } from "../src/index.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";

let sink: MemorySink;
let collector: Collector;

beforeEach(() => {
  _reset();
  sink = new MemorySink();
  collector = configure({ sink, batchSize: 1000, flushIntervalMs: 60_000 });
});

const evt = (over: Record<string, unknown> = {}) => ({
  model: "claude-sonnet-5",
  inputTokens: 1000,
  outputTokens: 200,
  ...over,
});

describe("metadata-only is structural, not policy", () => {
  it("strips anything that could carry content", () => {
    // The mistake a hurried integration makes: record({ ...response }).
    const { clean, dropped } = sanitize({
      model: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 5,
      messages: [{ role: "user", content: "my customer's private data" }],
      text: "the completion",
      content: [{ type: "text", text: "secret" }],
      choices: [{ message: { content: "secret" } }],
    });
    expect(Object.keys(clean).sort()).toEqual(["inputTokens", "model", "outputTokens"]);
    expect(dropped.sort()).toEqual(["choices", "content", "messages", "text"]);
  });

  it("never lets content reach the sink even when spread in wholesale", async () => {
    collector.record({ ...evt(), messages: [{ content: "PII" }], text: "completion" });
    await collector.flush();
    const serialized = JSON.stringify(sink.calls);
    expect(serialized).not.toContain("PII");
    expect(serialized).not.toContain("completion");
    expect(sink.calls).toHaveLength(1);
  });

  it("warns about dropped keys rather than failing silently", async () => {
    const seen: string[] = [];
    const c = new Collector({
      sink: new MemorySink(),
      onError: (err) => seen.push(err instanceof Error ? err.message : String(err)),
    });
    c.record({ ...evt(), prompt: "hello" });
    await c.flush();
    expect(seen.some((m) => m.includes("prompt"))).toBe(true);
  });
});

describe("trace context", () => {
  it("groups a parallel fan-out into one trace without threading an id", async () => {
    // SiteBeacon's recognition report: five models, one outcome, callModel knows
    // nothing about the trace it belongs to.
    await withTrace({ outcome: "recognition report", customer: "acme" }, async () => {
      await Promise.all(
        ["anthropic/claude-haiku-4.5", "openai/gpt-4o-mini", "google/gemini-2.5-flash"].map(
          async (model) => collector.record(evt({ model })),
        ),
      );
    });
    await collector.flush();

    const ids = new Set(sink.calls.map((c) => c.traceId));
    expect(ids.size).toBe(1);
    expect(sink.calls).toHaveLength(3);
    expect(sink.calls.every((c) => c.customer === "acme")).toBe(true);

    // Asserted, not merely present in the fixture. `outcome` sat in this test's
    // withTrace from the beginning and nothing checked it, so a build that
    // dropped the field entirely still went green — and the first production
    // capture came back with a null functional unit, which is the denominator of
    // SCI, the headline metric. A fixture field nobody asserts is not coverage.
    expect(sink.calls.every((c) => c.outcome === "recognition report")).toBe(true);
  });

  it("assigns sequence numbers so fan-out order survives batching", async () => {
    withTrace({ outcome: "x" }, () => {
      collector.record(evt());
      collector.record(evt());
      collector.record(evt());
    });
    await collector.flush();
    expect(sink.calls.map((c) => c.seq)).toEqual([0, 1, 2]);
  });

  it("gives an uninstrumented call its own trace rather than dropping it", async () => {
    // Partial instrumentation should degrade the number, never lose it.
    collector.record(evt());
    collector.record(evt());
    await collector.flush();
    expect(sink.calls).toHaveLength(2);
    expect(new Set(sink.calls.map((c) => c.traceId)).size).toBe(2);
  });

  it("lets an explicit traceId override the ambient one", async () => {
    withTrace({ traceId: "ambient" }, () => collector.record(evt({ traceId: "explicit" })));
    await collector.flush();
    expect(sink.calls[0]?.traceId).toBe("explicit");
  });

  it("fills call-level attribution gaps from the trace", async () => {
    withTrace({ team: "support", feature: "triage", customer: "globex" }, () =>
      collector.record(evt({ feature: "override" })),
    );
    await collector.flush();
    expect(sink.calls[0]).toMatchObject({
      team: "support",
      feature: "override",
      customer: "globex",
    });
  });
});

describe("model id normalisation", () => {
  it("collapses the notational difference that would split one model into two rows", () => {
    // SiteBeacon calls the same model both ways. Costs would have been right;
    // a model breakdown would have shown two rows and understated each.
    expect(normalizeModelId("anthropic/claude-haiku-4.5")).toBe("anthropic/claude-haiku-4-5");
    expect(normalizeModelId("claude-haiku-4.5")).toBe("claude-haiku-4-5");
    expect(sameModel("anthropic/claude-haiku-4.5", "claude-haiku-4-5")).toBe(true);
  });

  it("preserves the provider prefix, because gateway pricing genuinely differs", () => {
    expect(normalizeModelId("anthropic/claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
    expect(normalizeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });

  it("does NOT merge a dated snapshot with its floating alias", () => {
    // A wrong merge silently averages two different models. A duplicate row is
    // at least visible. Narrow on purpose.
    expect(sameModel("claude-sonnet-4-5", "claude-sonnet-4-5-20250929")).toBe(false);
  });

  it("lowercases without mangling anything else", () => {
    expect(normalizeModelId("  Claude-Sonnet-5  ")).toBe("claude-sonnet-5");
    expect(normalizeModelId("gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});

describe("adapters", () => {
  it("reads AI SDK v7 usage and the older field names", async () => {
    recordAiSdkResult({ usage: { inputTokens: 100, outputTokens: 50 } }, { model: "m" });
    recordAiSdkResult({ usage: { promptTokens: 7, completionTokens: 3 } }, { model: "m" });
    await collector.flush();
    expect(sink.calls[0]).toMatchObject({ inputTokens: 100, outputTokens: 50 });
    expect(sink.calls[1]).toMatchObject({ inputTokens: 7, outputTokens: 3 });
  });

  it("takes the billed cost from the AI Gateway, which the engine treats as exact", async () => {
    // The Gateway sends a decimal string. Without it the engine prices from the
    // LiteLLM catalogue at Tier 2 with a band; with it, cost is Tier 4 exact —
    // the one figure on the report that reconciles to an invoice.
    recordAiSdkResult(
      { usage: { inputTokens: 10, outputTokens: 5 }, providerMetadata: { gateway: { cost: "0.0045405" } } },
      { model: "m" },
    );
    await collector.flush();
    expect(sink.calls[0]?.billedCostUsd).toBe(0.0045405);
  });

  it("ignores an unparseable cost rather than poisoning every total that sums it", async () => {
    // A NaN here would propagate silently through every rollup. Absent cost is a
    // lower tier; NaN cost is a wrong report.
    for (const cost of ["", "not-a-number", "-1", null, undefined, {}]) {
      recordAiSdkResult(
        { usage: { inputTokens: 1, outputTokens: 1 }, providerMetadata: { gateway: { cost } } },
        { model: "m" },
      );
    }
    // marketCost is the market rate, not what was charged — never read it.
    recordAiSdkResult(
      { usage: { inputTokens: 1, outputTokens: 1 }, providerMetadata: { gateway: { marketCost: "0.99" } } },
      { model: "m" },
    );
    await collector.flush();
    for (const c of sink.calls) expect(c.billedCostUsd).toBeUndefined();
  });

  it("records a failed call and rethrows, because failures still burn tokens", async () => {
    const failing = instrumentGenerateText(async () => {
      throw new Error("provider outage");
    });
    await expect(failing({ model: "openai/gpt-4o-mini" })).rejects.toThrow("provider outage");
    await collector.flush();
    expect(sink.calls[0]?.error).toContain("provider outage");
  });

  it("counts Anthropic cache CREATION as input, not as a cached saving", async () => {
    // Cache writes are billed at a premium and do full prefill work. Folding them
    // into cachedTokens would make a cache write look like a discount.
    recordAnthropicMessage({
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 900,
        cache_read_input_tokens: 50,
      },
    });
    await collector.flush();
    expect(sink.calls[0]).toMatchObject({ inputTokens: 1000, cachedTokens: 50 });
  });

  it("extracts usage from every provider dialect", () => {
    expect(extractUsage({ usage: { input_tokens: 5, output_tokens: 6 } })).toMatchObject({
      inputTokens: 5,
      outputTokens: 6,
    });
    expect(extractUsage({ usage: { prompt_tokens: 5, completion_tokens: 6 } })).toMatchObject({
      inputTokens: 5,
      outputTokens: 6,
    });
    expect(
      extractUsage({ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6 } }),
    ).toMatchObject({ inputTokens: 5, outputTokens: 6 });
  });

  it("recovers the model from a Gemini REST URL", () => {
    expect(
      modelFromUrl(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=x",
      ),
    ).toBe("gemini-2.5-flash");
  });
});

describe("resilience — instrumentation must never break the host", () => {
  it("does not throw when a sink fails", async () => {
    const errors: string[] = [];
    const broken: Sink = {
      name: "broken",
      write() {
        throw new Error("disk full");
      },
    };
    const c = new Collector({ sink: broken, onError: (_e, ctx) => errors.push(ctx) });
    c.record(evt());
    await expect(c.flush()).resolves.toBeUndefined();
    expect(errors[0]).toContain("broken");
  });

  it("drops a failed batch rather than growing an unbounded retry queue", async () => {
    // An unbounded queue in a customer's process is a memory leak that surfaces
    // as our fault during their incident. Losing telemetry is the better failure.
    const c = new Collector({
      sink: {
        name: "broken",
        write() {
          throw new Error("nope");
        },
      },
      onError: () => {},
    });
    c.record(evt());
    await c.flush();
    expect(c.pending).toBe(0);
  });

  it("rejects a record with no model instead of writing a useless row", async () => {
    collector.record({ inputTokens: 1, outputTokens: 1 });
    await collector.flush();
    expect(sink.calls).toHaveLength(0);
  });

  it("keeps writing to healthy sinks when one of several fails", async () => {
    const good = new MemorySink();
    const multi = new MultiSink([
      { name: "bad", write() { throw new Error("x"); } },
      good,
    ]);
    const c = new Collector({ sink: multi, onError: () => {} });
    c.record(evt());
    await c.flush();
    expect(good.calls).toHaveLength(1);
  });

  it("is a no-op when nothing is configured", () => {
    _reset();
    expect(() => record(evt())).not.toThrow();
  });
});

describe("replay into engine input", () => {
  it("reassembles traces in fan-out order using seq, not timestamp", () => {
    // Parallel calls can share a timestamp to the millisecond; seq is what
    // preserves the order the application actually issued them in.
    const stamp = "2026-08-01T10:00:00.000Z";
    const traces = toTraces([
      { id: "c", traceId: "t", seq: 2, timestamp: stamp, provider: "p", model: "m", inputTokens: 1, outputTokens: 1 },
      { id: "a", traceId: "t", seq: 0, timestamp: stamp, provider: "p", model: "m", inputTokens: 1, outputTokens: 1 },
      { id: "b", traceId: "t", seq: 1, timestamp: stamp, provider: "p", model: "m", inputTokens: 1, outputTokens: 1 },
    ]);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.calls.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("attaches outcome metadata so SCI has a denominator", () => {
    const traces = toTraces(
      [{ id: "a", traceId: "t", seq: 0, timestamp: "2026-08-01T10:00:00.000Z", provider: "p", model: "m", inputTokens: 1, outputTokens: 1 }],
      new Map([["t", { outcome: "recognition report", outcomeCount: 1 }]]),
    );
    expect(traces[0]?.outcome).toBe("recognition report");
  });
});

describe("shutdown", () => {
  it("does not lose auto-flushed batches when the process closes", async () => {
    // Size-triggered flushes are fire-and-forget, because record() is synchronous
    // and cannot await. Without a write chain, close() returned before those
    // writes landed and an exiting process silently dropped telemetry. Caught by
    // the end-to-end demo finding an empty capture file.
    let resolveWrite: () => void = () => {};
    const slow: Sink = {
      name: "slow",
      write: () =>
        new Promise<void>((res) => {
          resolveWrite = res;
        }),
    };
    const c = new Collector({ sink: slow, batchSize: 1, flushIntervalMs: 60_000 });

    c.record(evt());
    const closing = c.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on the in-flight write

    resolveWrite();
    await closing;
    expect(settled).toBe(true);
  });

  it("stops accepting records once closed", async () => {
    const s = new MemorySink();
    const c = new Collector({ sink: s });
    await c.close();
    c.record(evt());
    await c.flush();
    expect(s.calls).toHaveLength(0);
  });
});

describe("auto-capture must not double-count", () => {
  it("stays quiet under an explicit adapter", async () => {
    // register() patches global fetch. An app that ALSO uses the explicit
    // adapters would otherwise record each call twice — once by the wrapper,
    // once by the patched fetch beneath it — inflating every figure silently.
    //
    // Deduplicating by content is NOT an option: SiteBeacon's discovery loop
    // legitimately issues near-identical calls, and dropping those would
    // understate. So explicit adapters claim their async context instead.
    const seen: string[] = [];
    const fakeFetch = instrumentedFetch({ match: [/example\.test/] });

    const wrapped = instrumentGenerateText(async () => {
      // Stands in for the provider HTTP call the AI SDK makes internally.
      await fakeFetch("https://example.test/v1/messages").catch(() => undefined);
      seen.push("inner fetch ran");
      return { usage: { inputTokens: 10, outputTokens: 5 } };
    });

    await wrapped({ model: "claude-sonnet-5" });
    await collector.flush();

    expect(seen).toHaveLength(1);
    expect(sink.calls).toHaveLength(1); // one call, not two
    expect(sink.calls[0]).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it("still captures a bare fetch when no adapter claimed it", async () => {
    // Same fetch, no suppressing wrapper: it must record. The host is
    // unresolvable, so this exercises the failure path — which still records,
    // because a call that happened and was not counted understates the footprint.
    const f = instrumentedFetch({ match: [/example\.invalid/] });
    await f("https://example.invalid/v1/messages").catch(() => undefined);
    await collector.flush();
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0]?.error).toBeTruthy();
  });
});

describe("register()", () => {
  it("is idempotent — Next.js can evaluate instrumentation.ts more than once", async () => {
    const s = new MemorySink();
    const a = register({ sink: s, patchFetch: false });
    const b = register({ sink: new MemorySink(), patchFetch: false });
    expect(a).toBe(b); // second call is a no-op, not a second collector
    a.unregister();
  });

  it("patches fetch exactly once even across repeated registration", () => {
    const before = globalThis.fetch;
    const r1 = register({ sink: new MemorySink() });
    const patched = globalThis.fetch;
    register({ sink: new MemorySink() });
    expect(globalThis.fetch).toBe(patched);
    r1.unregister();
    expect(globalThis.fetch).toBe(before);
  });

  it("falls back to a memory sink rather than throwing on misconfiguration", () => {
    // Instrumentation must never be the reason a deploy fails to boot.
    const r = register({ patchFetch: false });
    expect(r.sink.name).toBe("memory");
    r.unregister();
  });

  it("traceRequest makes one request one trace", async () => {
    const s = new MemorySink();
    const c = configure({ sink: s, batchSize: 100, flushIntervalMs: 60_000 });
    const handler = traceRequest(async () => {
      c.record(evt());
      c.record(evt());
    }, { outcome: "audit" });
    await handler();
    await c.flush();
    expect(new Set(s.calls.map((x) => x.traceId)).size).toBe(1);
  });
});

describe("setTraceMeta", () => {
  it("enriches a trace after it has started", async () => {
    // The customer is usually not known when the request handler opens the
    // trace — it is loaded a few lines later. Requiring it up front would push
    // withTrace deeper into the app, which is the threading problem it avoids.
    await withTrace({ outcome: "audit" }, async () => {
      setTraceMeta({ customer: "acme", feature: "recognition" });
      collector.record(evt());
    });
    await collector.flush();
    expect(sink.calls[0]).toMatchObject({ customer: "acme", feature: "recognition" });
  });

  it("is a no-op outside a trace rather than an error", () => {
    expect(() => setTraceMeta({ customer: "x" })).not.toThrow();
  });
});

describe("unwritable capture path", () => {
  it("explains the fix once instead of failing opaquely every batch", async () => {
    // On Vercel the working directory is read-only, so every append failed into
    // a generic warning and the capture came back empty — a report that looks
    // complete and is not. The raw EROFS tells a customer nothing, so the first
    // failure has to name the fix.
    //
    // Uses a regular file as a parent directory, which is unwritable on every
    // platform. A hardcoded Unix path like /proc silently SUCCEEDS on Windows,
    // where mkdir -p happily creates C:\proc — which is how the first version
    // of this test passed while proving nothing.
    const parent = join(tmpdir(), `tetrameter-not-a-dir-${Date.now()}`);
    await writeFile(parent, "");

    const messages: string[] = [];
    const c = new Collector({
      sink: new JsonlFileSink(join(parent, "capture.jsonl")),
      batchSize: 1,
      onError: (err) => messages.push(err instanceof Error ? err.message : String(err)),
    });

    c.record(evt());
    await c.flush();
    c.record(evt());
    await c.flush();

    expect(messages.length).toBe(2);
    expect(messages[0]).toMatch(/not writable|TETRAMETER_CAPTURE/);
    // Second failure is the raw error: repeating the paragraph every batch
    // buries the signal in the customer's logs.
    expect(messages[1]).not.toMatch(/TETRAMETER_CAPTURE/);

    await rm(parent, { force: true });
  });
});

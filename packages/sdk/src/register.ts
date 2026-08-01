/**
 * One-line auto-instrumentation.
 *
 *     // instrumentation.ts — Next.js runs this at server startup
 *     import { register } from "@kumokodo/tetrameter-sdk/register";
 *     register({ apiKey: process.env.TETRAMETER_KEY });
 *
 * Patches global `fetch`, so every provider call records itself with no change
 * at any call site. This is the tier that should exist before the explicit SDK:
 * the SiteBeacon integration we hand-wrote touched two files and required
 * understanding where a trace begins, and most of that was avoidable.
 *
 * ── What this does and does not give you ────────────────────────────────────
 *
 *   ✓ every provider call captured — cost, energy, carbon, water, land
 *   ✓ no double-counting if you also use the explicit adapters
 *   ~ trace grouping ONLY if you supply it: `withTrace`, `traceRequest`, or an
 *     existing OpenTelemetry span
 *   ✗ per-customer attribution — nothing can infer that a call belongs to
 *     acme-corp, so `setTraceMeta({ customer })` is still yours to call
 *
 * That last line is the honest floor of any auto-instrumentation, and it is
 * also exactly what makes this worth more than a proxy.
 *
 * ── Why patching is guarded rather than clever ──────────────────────────────
 *
 * Monkey-patching is fragile across major versions. So: patch once, patch only
 * `fetch` (a stable web standard rather than a vendor's internals), and fail
 * loudly rather than silently. An instrumentation library that quietly stops
 * recording is worse than one that never started, because the resulting report
 * looks complete.
 */

import { Collector, configure, type CollectorOptions } from "./record.js";
import { instrumentedFetch, type InstrumentedFetchOptions } from "./adapters/fetch.js";
import { HttpSink, JsonlFileSink, MemorySink } from "./sinks.js";
import { newTraceId, withTrace } from "./trace.js";
import type { CallEvent, Sink } from "./types.js";

export interface RegisterOptions extends Omit<Partial<CollectorOptions>, "sink"> {
  /** Send to the hosted ingest. Omit to capture locally instead. */
  readonly apiKey?: string;
  readonly ingestUrl?: string;
  /** Capture to a JSONL file. Useful before any backend exists. */
  readonly captureFile?: string;
  /** Supply your own sink and we will not choose one. */
  readonly sink?: Sink;
  /** Attribution applied to every call — usually `team`, and `region` if known. */
  readonly defaults?: Partial<CallEvent>;
  /** Extra URL patterns to treat as provider calls. */
  readonly match?: InstrumentedFetchOptions["match"];
  /** Skip patching global fetch. For tests, or when you only want the helpers. */
  readonly patchFetch?: boolean;
}

interface Registration {
  readonly collector: Collector;
  readonly sink: Sink;
  /** Undo the patch. Mostly for tests. */
  unregister(): void;
}

const PATCH_MARK = Symbol.for("tetrameter.fetch.patched");

let current: Registration | undefined;

function chooseSink(opts: RegisterOptions): Sink {
  if (opts.sink) return opts.sink;
  if (opts.apiKey) {
    return new HttpSink({
      url: opts.ingestUrl ?? "https://ingest.tetrameter.ai/v1/calls",
      apiKey: opts.apiKey,
    });
  }
  if (opts.captureFile) return new JsonlFileSink(opts.captureFile);
  const envFile = process.env["TETRAMETER_CAPTURE"];
  if (envFile) return new JsonlFileSink(envFile);
  // No destination configured. A memory sink keeps the app working and makes the
  // misconfiguration obvious on inspection, rather than throwing at startup —
  // instrumentation must never be the reason a deploy fails to boot.
  return new MemorySink();
}

/**
 * Install auto-instrumentation. Idempotent: calling twice does not double-patch,
 * which matters because Next.js can evaluate `instrumentation.ts` more than once
 * across runtimes, and a double patch would double every number.
 */
export function register(opts: RegisterOptions = {}): Registration {
  if (current) return current;

  const sink = chooseSink(opts);
  const collector = configure({
    sink,
    ...(opts.defaults !== undefined ? { defaults: opts.defaults } : {}),
    ...(opts.batchSize !== undefined ? { batchSize: opts.batchSize } : {}),
    ...(opts.flushIntervalMs !== undefined ? { flushIntervalMs: opts.flushIntervalMs } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
  });

  let unpatch = (): void => {};

  if (opts.patchFetch !== false) {
    const existing = globalThis.fetch as (typeof globalThis.fetch & { [PATCH_MARK]?: true }) | undefined;
    if (typeof existing !== "function") {
      // Node 18+ and every edge runtime provide fetch. If it is missing we are
      // somewhere unexpected; say so rather than pretend to be recording.
      (opts.onError ?? console.warn)(
        new Error("global fetch is unavailable — auto-capture disabled, use the explicit adapters"),
        "register",
      );
    } else if (existing[PATCH_MARK]) {
      // Already patched by another copy of this package in the tree.
      unpatch = () => {};
    } else {
      const original = existing;
      const patched = instrumentedFetch({
        ...(opts.match !== undefined ? { match: opts.match } : {}),
      }) as typeof globalThis.fetch & { [PATCH_MARK]?: true };
      patched[PATCH_MARK] = true;
      globalThis.fetch = patched;
      unpatch = () => {
        globalThis.fetch = original;
      };
    }
  }

  current = {
    collector,
    sink,
    unregister() {
      unpatch();
      current = undefined;
    },
  };
  return current;
}

/** The active registration, if `register()` has run. */
export function registration(): Registration | undefined {
  return current;
}

/**
 * Wrap a request handler so each request becomes one trace.
 *
 * For a web app this is usually the right boundary and it costs one line:
 *
 *     export const POST = traceRequest(async (req) => { … });
 *
 * "Usually" is doing real work in that sentence. It is a good default, not a
 * correct one — a background job, a queue consumer, or a route that runs several
 * independent AI workflows needs `withTrace` placed deliberately. SiteBeacon's
 * `runFullAudit` is a case where the explicit wrap is genuinely better, because
 * one audit is the business outcome regardless of how it was triggered.
 */
export function traceRequest<A extends unknown[], R>(
  handler: (...args: A) => R,
  meta: { outcome?: string } = {},
): (...args: A) => R {
  return function traced(...args: A): R {
    return withTrace({ traceId: newTraceId(), ...meta }, () => handler(...args));
  };
}

/**
 * Ambient trace context, and auto-capture suppression.
 *
 * ── Why the trace context exists ────────────────────────────────────────────
 *
 * The trace is our unit of measurement, but almost no real codebase threads a
 * trace id through its call sites. SiteBeacon's recognition audit is the exact
 * case: `runFullAudit` fans out `models × (1 + runsPerModel)` calls through a
 * pool, and `callModel` knows nothing about the audit it belongs to.
 *
 * Asking a customer to thread an id through every call site is how
 * instrumentation projects die. `AsyncLocalStorage` carries it implicitly, so
 * wrapping the *outer* function is enough.
 *
 * ── Why suppression exists ──────────────────────────────────────────────────
 *
 * Once `register()` patches global `fetch`, an app that ALSO uses the explicit
 * adapters would record each call twice — once by the wrapper, once by the
 * patched fetch underneath it. Every figure would inflate, silently, in exactly
 * the direction that flatters nobody and discredits the report.
 *
 * Content-hashing to deduplicate is not an option: SiteBeacon's discovery loop
 * legitimately issues near-identical calls (same model, same template, similar
 * token counts), and dropping those would *understate*. Both directions of error
 * are unacceptable, so we do not guess.
 *
 * Instead the explicit adapters mark their async context as claimed, and the
 * patched fetch running underneath sees the mark and stays quiet. Explicit
 * always wins, because it carries better attribution than an interceptor can.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TraceContext } from "./types.js";

interface TraceStore {
  ctx: TraceContext;
  seq: number;
}

const traceStorage = new AsyncLocalStorage<TraceStore>();
const suppressStorage = new AsyncLocalStorage<true>();

/**
 * Trace ids are generated here rather than taken from the caller so they are
 * unique without coordination. `crypto.randomUUID` where available, with a
 * non-crypto fallback — these are correlation keys, not security tokens, so
 * collision resistance matters and unpredictability does not.
 */
export function newTraceId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Run `fn` inside a trace. Every `record()` beneath it joins the same trace.
 *
 * Returns whatever `fn` returns and does not swallow its errors: a trace that
 * failed is still a trace, and the calls it made still consumed resources.
 */
export function withTrace<T>(
  ctx: Omit<TraceContext, "traceId"> & { traceId?: string },
  fn: () => T,
): T {
  const full: TraceContext = { ...ctx, traceId: ctx.traceId ?? newTraceId() };
  return traceStorage.run({ ctx: full, seq: 0 }, fn);
}

/** The current trace, if any. */
export function currentTrace(): TraceContext | undefined {
  return traceStorage.getStore()?.ctx;
}

/**
 * Enrich the current trace after it has started.
 *
 * The outcome and the customer are frequently not known when the trace opens —
 * a request handler starts a trace, then loads the org and works out what it is
 * doing. Requiring both up front would push `withTrace` deeper into the app,
 * which is exactly the threading problem it exists to avoid.
 *
 * A no-op outside a trace rather than an error: enrichment should never be the
 * thing that breaks a request.
 */
export function setTraceMeta(meta: Partial<Omit<TraceContext, "traceId">>): void {
  const store = traceStorage.getStore();
  if (!store) return;
  store.ctx = { ...store.ctx, ...meta };
}

/**
 * Next sequence number within the current trace. Monotonic per trace so fan-out
 * ordering survives a transport that reorders or a sink that batches.
 */
export function nextSeq(): number {
  const store = traceStorage.getStore();
  if (!store) return 0;
  return store.seq++;
}

/**
 * Run `fn` with auto-capture disabled for anything beneath it.
 *
 * Used by the explicit adapters so a patched global `fetch` underneath does not
 * record the same call a second time.
 */
export function suppressAutoCapture<T>(fn: () => T): T {
  return suppressStorage.run(true, fn);
}

/** True when an explicit adapter has already claimed the current call. */
export function isAutoCaptureSuppressed(): boolean {
  return suppressStorage.getStore() === true;
}

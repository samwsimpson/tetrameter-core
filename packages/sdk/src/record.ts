/**
 * The collector primitive.
 *
 * Everything else in this package is sugar over `record()`. That ordering is
 * deliberate and was decided by looking at real code rather than by design
 * preference: SiteBeacon has three integration shapes — the Vercel AI SDK via
 * `generateText`, a raw `fetch` to Gemini's REST endpoint, and a raw `fetch` to
 * Anthropic's. An SDK-wrapper-first collector would have instrumented one of the
 * three and silently missed the other two.
 *
 * So the primitive is a plain function anyone can call from anywhere, and the
 * adapters are thin conveniences on top.
 */

import { normalizeModelId } from "./normalize.js";
import { currentTrace, newTraceId, nextSeq } from "./trace.js";
import type { CallEvent, RecordedCall, Sink } from "./types.js";

/**
 * Keys allowed out of the process. Anything else a caller passes — a spread
 * provider response, a `messages` array, a `text` field — is dropped here.
 *
 * The type system already makes content unrepresentable, but JavaScript callers
 * do not get the type system, and `record({ ...response })` is exactly the
 * mistake a hurried integration makes. Two layers, because the cost of the second
 * is one array and the cost of leaking a prompt is the company.
 */
const ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  "model",
  "provider",
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "region",
  "durationMs",
  "billedCostUsd",
  "team",
  "feature",
  "customer",
  "traceId",
  "timestamp",
  "error",
  "outcome",
  "outcomeCount",
]);

/** Strip anything not on the allow-list. Returns the dropped keys for warning. */
export function sanitize(input: Record<string, unknown>): {
  clean: Record<string, unknown>;
  dropped: string[];
} {
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (ALLOWED_KEYS.has(k)) clean[k] = v;
    else dropped.push(k);
  }
  return { clean, dropped };
}

export interface CollectorOptions {
  readonly sink: Sink;
  /** Defaults applied to every call — usually team, and region if you know it. */
  readonly defaults?: Partial<CallEvent>;
  /**
   * Buffer size before an automatic flush. Batching is not an optimisation here,
   * it is the difference between viable and not: at 250M events/month a
   * per-event network call would dominate the entire infrastructure budget.
   */
  readonly batchSize?: number;
  /** Flush a partial batch after this many ms. */
  readonly flushIntervalMs?: number;
  /**
   * Called when a record is dropped or a sink fails. Defaults to a console
   * warning. Instrumentation must never break the application it observes, so
   * failures are reported, never thrown.
   */
  readonly onError?: (err: unknown, context: string) => void;
}

export class Collector {
  readonly #sink: Sink;
  readonly #defaults: Partial<CallEvent>;
  readonly #batchSize: number;
  readonly #flushIntervalMs: number;
  readonly #onError: (err: unknown, context: string) => void;

  #buffer: RecordedCall[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  /**
   * Serialises writes and lets `flush`/`close` await work already in flight.
   *
   * Size- and timer-triggered flushes are necessarily fire-and-forget — `record()`
   * is synchronous and cannot await. Without this chain, `close()` returned before
   * those writes landed and a process exiting dropped whatever was mid-write.
   * Silently, which is the worst kind.
   *
   * Serialising also keeps JSONL append order intact; concurrent appends to one
   * file can interleave partial lines.
   */
  #chain: Promise<void> = Promise.resolve();

  constructor(opts: CollectorOptions) {
    this.#sink = opts.sink;
    this.#defaults = opts.defaults ?? {};
    this.#batchSize = opts.batchSize ?? 200;
    this.#flushIntervalMs = opts.flushIntervalMs ?? 5_000;
    this.#onError =
      opts.onError ??
      ((err, context) => {
        console.warn(`[tetrameter] ${context}:`, err instanceof Error ? err.message : err);
      });
  }

  /**
   * Record one call. Never throws — a collector that can break the host
   * application will be removed from the host application.
   */
  record(event: CallEvent | Record<string, unknown>): void {
    if (this.#closed) return;
    try {
      const { clean, dropped } = sanitize(event as Record<string, unknown>);
      if (dropped.length > 0) {
        this.#onError(
          new Error(`dropped non-metadata keys: ${dropped.join(", ")}`),
          "record sanitisation",
        );
      }

      const e = { ...this.#defaults, ...clean } as CallEvent;
      if (typeof e.model !== "string" || e.model.length === 0) {
        this.#onError(new Error("record() requires a model"), "record validation");
        return;
      }

      const trace = currentTrace();
      // Resolved separately rather than inline: under exactOptionalPropertyTypes
      // a conditional spread of `a ?? b` still widens to `string | undefined`.
      const team = e.team ?? trace?.team;
      const outcome = trace?.outcome;
      const outcomeCount = trace?.outcomeCount;
      const feature = e.feature ?? trace?.feature;
      const customer = e.customer ?? trace?.customer;

      const recorded: RecordedCall = {
        ...e,
        model: normalizeModelId(e.model),
        provider: e.provider ?? providerFromModel(e.model),
        inputTokens: Math.max(0, Math.trunc(e.inputTokens ?? 0)),
        outputTokens: Math.max(0, Math.trunc(e.outputTokens ?? 0)),
        id: `${Date.now().toString(36)}-${(this.#buffer.length + 1).toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        // Explicit traceId wins, then the ambient trace, then a singleton trace.
        // Never dropped: partial instrumentation should degrade the number, not lose it.
        traceId: e.traceId ?? trace?.traceId ?? newTraceId(),
        timestamp: e.timestamp ?? new Date().toISOString(),
        seq: nextSeq(),
        // Trace-level attribution fills gaps the call site did not supply.
        ...(team !== undefined ? { team } : {}),
        ...(feature !== undefined ? { feature } : {}),
        ...(customer !== undefined ? { customer } : {}),
        // Denormalised from the trace so a capture is self-describing. See
        // RecordedCall.outcome for why this is repeated rather than emitted once.
        ...(outcome !== undefined ? { outcome } : {}),
        ...(outcomeCount !== undefined ? { outcomeCount } : {}),
      };

      this.#buffer.push(recorded);
      if (this.#buffer.length >= this.#batchSize) void this.flush();
      else this.#scheduleFlush();
    } catch (err) {
      this.#onError(err, "record");
    }
  }

  #scheduleFlush(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#flushIntervalMs);
    // Do not hold a short-lived process open just to flush telemetry.
    this.#timer.unref?.();
  }

  /** Flush the buffer, and await anything already in flight. */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    if (this.#buffer.length > 0) {
      const batch = this.#buffer;
      this.#buffer = [];
      this.#chain = this.#chain.then(async () => {
        try {
          await this.#sink.write(batch);
          await this.#sink.flush?.();
        } catch (err) {
          // Deliberately not re-buffered. An unbounded retry queue in a customer's
          // process is a memory leak that surfaces as *our* fault during their
          // incident. Losing telemetry is the acceptable failure; taking down the
          // host application is not.
          this.#onError(err, `sink ${this.#sink.name} write (${batch.length} calls lost)`);
        }
      });
    }

    await this.#chain;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.flush();
    try {
      await this.#sink.close?.();
    } catch (err) {
      this.#onError(err, `sink ${this.#sink.name} close`);
    }
  }

  /** Buffered but unflushed calls. Exposed for tests and shutdown checks. */
  get pending(): number {
    return this.#buffer.length;
  }
}

function providerFromModel(model: string): string {
  const slash = model.indexOf("/");
  if (slash > 0) return model.slice(0, slash);
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o[1-9]|text-embedding)/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "google";
  if (/^(mistral|magistral|codestral)/i.test(model)) return "mistral";
  if (/^grok/i.test(model)) return "xai";
  if (/^(llama|meta-llama)/i.test(model)) return "meta";
  return "unknown";
}

/** Module-level collector, so `record()` can be a bare import. */
let active: Collector | undefined;

export function configure(opts: CollectorOptions): Collector {
  active = new Collector(opts);
  return active;
}

/** Record against the configured collector. A no-op if none is configured. */
export function record(event: CallEvent | Record<string, unknown>): void {
  active?.record(event);
}

export async function flush(): Promise<void> {
  await active?.flush();
}

export async function close(): Promise<void> {
  await active?.close();
  active = undefined;
}

/** For tests. */
export function _reset(): void {
  active = undefined;
}

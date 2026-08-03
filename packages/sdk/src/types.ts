/**
 * What the collector accepts.
 *
 * ── Metadata-only is enforced here, not documented elsewhere ─────────────────
 *
 * There is no field on this type that can hold a prompt, a completion, a message
 * array or a tool result. That is the whole security posture: it is impossible to
 * send us content because there is nowhere to put it.
 *
 * `sanitize()` in record.ts additionally strips any unexpected keys before a
 * record leaves the process, so a caller who spreads a raw provider response into
 * `record()` cannot leak content by accident. Both layers exist because the first
 * one is a compile-time guarantee and JavaScript callers do not get compile time.
 */

/** Everything we need to compute four resources. Notably absent: any text. */
export interface CallEvent {
  /** Provider's model identifier, verbatim. Normalised on the way out. */
  readonly model: string;
  readonly provider?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens?: number;
  /**
   * Tokens written into the prompt cache. Disjoint from `inputTokens` and
   * `cachedTokens`, because a provider prices all three differently — a write
   * costs 1.25x input on Anthropic's five-minute TTL and 2x on the one-hour one.
   * Folded into `inputTokens`, as adapters did before this field, a write turn
   * reads cheaper than billed and any caching saving measured against it comes
   * out too large.
   */
  readonly cacheWriteTokens?: number;
  /** Where the provider reports them separately. */
  readonly reasoningTokens?: number;
  /** Grid zone, where knowable. Most commercial APIs do not disclose it. */
  readonly region?: string;
  readonly durationMs?: number;
  /** Exact billed cost, if the provider returns one. Beats any estimate. */
  readonly billedCostUsd?: number;

  /** Attribution. `customer` is the dimension nobody else carries. */
  readonly team?: string;
  readonly feature?: string;
  readonly customer?: string;

  /** Overrides the ambient trace, for callers not using `withTrace`. */
  readonly traceId?: string;
  /** ISO 8601. Defaults to now. */
  readonly timestamp?: string;
  /** Set when the call failed — recorded, because failed calls still burn tokens. */
  readonly error?: string;

  /**
   * The outcome this call served, for callers not using `withTrace`.
   *
   * A fallback, not the preferred route. `withTrace` is how a multi-call turn
   * declares one outcome; setting this on each of several calls in a trace is
   * harmless — outcomes are counted per trace, not per call — but it says
   * nothing `withTrace` would not say better.
   *
   * It is here because it was reachable at runtime and rejected at compile time:
   * `sanitize()` allows it, `RecordedCall` carries it, and only `CallEvent`
   * omitted it. An integration hit exactly that and had to widen the type
   * locally, which is a bug report about this interface rather than about their
   * code.
   */
  readonly outcome?: string;
  /**
   * How many outcomes this call's trace produced. Rarely set: the default of one
   * per trace is right unless a single trace genuinely serves a batch.
   */
  readonly outcomeCount?: number;
}

/** A recorded call: the event plus whatever the ambient context supplied. */
export interface RecordedCall extends CallEvent {
  readonly id: string;
  readonly traceId: string;
  readonly timestamp: string;
  readonly provider: string;
  /** Sequence within the trace, so fan-out order survives a lossy transport. */
  readonly seq: number;
  /**
   * The trace's outcome, denormalised onto every call.
   *
   * Deliberately repeated rather than emitted once per trace. A capture is a flat
   * append-only log that can be truncated, sampled or partially delivered; if the
   * outcome lived in a separate record, losing that one line would leave every
   * other row unattributable. Repeating a short string is the cheap side of that
   * trade.
   *
   * Without it, SCI — gCO2e per functional unit, the metric we lead with — cannot
   * be computed from a capture at all, because nothing says what the calls
   * accomplished. The first real SiteBeacon capture had exactly this hole.
   */
  readonly outcome?: string;
  readonly outcomeCount?: number;
}

/** Trace-level context: one business outcome. */
export interface TraceContext {
  readonly traceId: string;
  /** What this trace accomplishes — the SCI functional unit. */
  readonly outcome?: string;
  readonly outcomeCount?: number;
  readonly team?: string;
  readonly feature?: string;
  readonly customer?: string;
}

/** Where recorded calls go. Implementations must never throw into the caller. */
export interface Sink {
  readonly name: string;
  write(calls: readonly RecordedCall[]): void | Promise<void>;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

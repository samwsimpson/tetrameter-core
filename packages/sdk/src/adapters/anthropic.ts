/**
 * Anthropic SDK adapter.
 *
 * Covers Kodokyo, which calls `@anthropic-ai/sdk` directly across 25+ sites — but
 * routes all org-scoped calls through one wrapper, `createTrackedMessage` in
 * `src/lib/ai-tracked.ts`, which already carries `organizationId` and `feature`.
 *
 * That wrapper is a gift. Instrumenting Kodokyo is a few lines in one function
 * rather than a 25-file migration, and `organizationId` maps straight onto our
 * `customer` dimension — Kodokyo is multi-tenant, so their orgs *are* customers.
 * Per-customer attribution, the wedge, is testable on real data immediately.
 */

import { record } from "../record.js";
import { suppressAutoCapture } from "../trace.js";
import type { CallEvent } from "../types.js";

/** Structural, so we never import the Anthropic SDK or pin its version. */
export interface AnthropicMessageLike {
  readonly model?: string;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

export interface AnthropicRecordOptions extends Partial<Omit<CallEvent, "model">> {
  /** Falls back to the model on the response. */
  readonly model?: string;
}

/**
 * Record an Anthropic message response.
 *
 * The three token buckets are kept apart, because a provider prices them three
 * different ways. `cache_read_input_tokens` is the cheap one. `input_tokens` is
 * ordinary. `cache_creation_input_tokens` is the *expensive* one — 1.25x input
 * on the five-minute TTL, 2x on the one-hour — and it used to be folded into
 * `inputTokens` at 1.0x, which under-priced a write turn by around 19% while
 * leaving the read turns that followed exact. That is the wrong direction: it
 * makes a measured caching saving look bigger than it was.
 */
export function recordAnthropicMessage(
  response: AnthropicMessageLike,
  opts: AnthropicRecordOptions = {},
): void {
  const u = response.usage;

  record({
    ...opts,
    model: opts.model ?? response.model ?? "unknown",
    provider: opts.provider ?? "anthropic",
    // Fresh input only. Writes go to their own field so the engine can price the
    // premium; the energy side adds them back, because a write is a full prefill
    // and costs the same electricity as ordinary input regardless of billing.
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    ...(u?.cache_read_input_tokens !== undefined
      ? { cachedTokens: u.cache_read_input_tokens }
      : {}),
    ...(u?.cache_creation_input_tokens !== undefined
      ? { cacheWriteTokens: u.cache_creation_input_tokens }
      : {}),
  });
}

/**
 * Wrap `anthropic.messages.create`.
 *
 * For Kodokyo this drops into `createTrackedMessage` beside the existing
 * `recordAiUsage` call — the org and feature it already receives become our
 * customer and feature dimensions.
 */
export function instrumentAnthropicCreate<A extends { model?: unknown }, R extends AnthropicMessageLike>(
  create: (args: A) => Promise<R>,
  attribution: Partial<Omit<CallEvent, "model">> = {},
): (args: A) => Promise<R> {
  return async (args: A): Promise<R> => {
    const started = Date.now();
    const requested = typeof args.model === "string" ? args.model : undefined;
    try {
      // See instrumentGenerateText: claim the call so patched fetch stays quiet.
      const response = await suppressAutoCapture(() => create(args));
      recordAnthropicMessage(response, {
        ...attribution,
        ...(requested !== undefined ? { model: requested } : {}),
        durationMs: Date.now() - started,
      });
      return response;
    } catch (err) {
      record({
        ...attribution,
        model: requested ?? "unknown",
        provider: "anthropic",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
      throw err;
    }
  };
}

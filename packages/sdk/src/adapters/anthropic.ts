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
 * Note `cache_creation_input_tokens` is deliberately NOT folded into
 * `cachedTokens`. Cache *creation* is billed at a premium and does full prefill
 * work; cache *reads* are the cheap ones. Merging them would make a cache write
 * look like a saving, which is backwards.
 */
export function recordAnthropicMessage(
  response: AnthropicMessageLike,
  opts: AnthropicRecordOptions = {},
): void {
  const u = response.usage;
  const cacheCreation = u?.cache_creation_input_tokens ?? 0;

  record({
    ...opts,
    model: opts.model ?? response.model ?? "unknown",
    provider: opts.provider ?? "anthropic",
    // Cache creation counts as ordinary input: it is billed at a premium and does
    // the full prefill. Only cache reads are discounted.
    inputTokens: (u?.input_tokens ?? 0) + cacheCreation,
    outputTokens: u?.output_tokens ?? 0,
    ...(u?.cache_read_input_tokens !== undefined
      ? { cachedTokens: u.cache_read_input_tokens }
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

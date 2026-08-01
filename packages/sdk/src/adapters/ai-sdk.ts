/**
 * Vercel AI SDK adapter.
 *
 * Covers SiteBeacon's recognition fan-out, which calls `generateText` from `ai`
 * v7 through the AI Gateway, five models per report.
 *
 * The usage field was renamed between AI SDK versions — v7 uses
 * `inputTokens`/`outputTokens`, earlier versions `promptTokens`/`completionTokens`
 * — and SiteBeacon's own code already carries both fallbacks. We do the same
 * rather than pin a version, because an instrumentation library that breaks on a
 * minor upgrade gets removed.
 */

import { record } from "../record.js";
import { suppressAutoCapture } from "../trace.js";
import type { CallEvent } from "../types.js";

/** The shape we read. Structural, so we never import from `ai` and pin its version. */
export interface AiSdkResultLike {
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly cachedInputTokens?: number;
    readonly reasoningTokens?: number;
    readonly totalTokens?: number;
  };
  readonly providerMetadata?: Record<string, unknown>;
}

/**
 * The billed cost of the call, when the AI Gateway reported one.
 *
 * ── Why this is worth reaching for ──────────────────────────────────────────
 *
 * Without it the engine prices the call from the LiteLLM catalogue: a Tier 2
 * estimate carrying an uncertainty band, because list price is not what you were
 * charged. `gateway.cost` is what you were actually charged, so the engine
 * records it as Tier 4 — exact, no band. Cost is the figure a CFO checks first,
 * and it is the one number on the report that can be tied to an invoice.
 *
 * `cost`, never `marketCost`: the latter is the market rate for the same
 * inference, which is useful for a "what would this have cost elsewhere"
 * comparison and wrong for an inventory of what was spent.
 *
 * The Gateway sends it as a decimal *string* ("0.0045405"). Parsed defensively —
 * a NaN reaching the engine would silently poison every total that sums it, and
 * an absent cost is merely a lower tier, which is a far better failure.
 */
function gatewayCostUsd(result: AiSdkResultLike): number | undefined {
  const gateway = result.providerMetadata?.["gateway"];
  if (typeof gateway !== "object" || gateway === null) return undefined;

  const raw = (gateway as Record<string, unknown>)["cost"];
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;

  // `Number("")` and `Number(" ")` are 0, not NaN. Left to the numeric check
  // below, a missing cost would therefore record as "this call was free" —
  // understating spend, which is the error direction that matters here. Rejected
  // before parsing rather than after.
  if (typeof raw === "string" && raw.trim() === "") return undefined;

  const cost = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(cost) || cost < 0) return undefined;
  return cost;
}

export interface AiSdkRecordOptions extends Partial<Omit<CallEvent, "model">> {
  readonly model: string;
}

/**
 * Record the result of a `generateText` / `generateObject` call.
 *
 * Reads only the usage counters. `result.text` is never touched — the adapter
 * cannot leak a completion because it never reads one.
 */
export function recordAiSdkResult(result: AiSdkResultLike, opts: AiSdkRecordOptions): void {
  const u = result.usage;
  // An explicit cost at the call site wins: the caller may know the real invoiced
  // figure where the Gateway only knows its own.
  const billed = opts.billedCostUsd ?? gatewayCostUsd(result);
  record({
    ...opts,
    inputTokens: u?.inputTokens ?? u?.promptTokens ?? 0,
    outputTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
    ...(u?.cachedInputTokens !== undefined ? { cachedTokens: u.cachedInputTokens } : {}),
    ...(u?.reasoningTokens !== undefined ? { reasoningTokens: u.reasoningTokens } : {}),
    ...(billed !== undefined ? { billedCostUsd: billed } : {}),
  });
}

/**
 * Wrap a `generateText`-shaped function so every call records itself.
 *
 * Failures are recorded too, then rethrown. A failed call still consumed tokens
 * on the provider's side in most cases, and a fan-out that silently drops its
 * failures reports a smaller footprint than it caused — which is the direction of
 * error we care most about avoiding.
 */
export function instrumentGenerateText<
  A extends { model?: unknown },
  R extends AiSdkResultLike,
>(
  generate: (args: A) => Promise<R>,
  attribution: Partial<Omit<CallEvent, "model">> = {},
): (args: A) => Promise<R> {
  return async (args: A): Promise<R> => {
    const started = Date.now();
    const model = typeof args.model === "string" ? args.model : String(args.model ?? "unknown");
    try {
      // Claim this call so a patched global fetch underneath does not record it
      // a second time. Explicit wins: it carries better attribution.
      const result = await suppressAutoCapture(() => generate(args));
      recordAiSdkResult(result, {
        ...attribution,
        model,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      record({
        ...attribution,
        model,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
      throw err;
    }
  };
}

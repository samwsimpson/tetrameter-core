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
 *
 * ── Embeddings report usage under a third name again ────────────────────────
 *
 * `embed` and `embedMany` return `usage: { tokens }` — not `inputTokens`, not
 * `promptTokens`. Until 0.2.1 this adapter read neither, so every embedding it
 * recorded landed as 0 input and 0 output with no `error` set: identical, on the
 * wire and in the dashboard, to a call that genuinely cost nothing. An
 * embedding-heavy integration would have reported a footprint near zero and
 * looked healthy doing it.
 *
 * That is the failure mode this library exists to avoid, and it survived because
 * the adapter was written against one call shape and the type it reads through
 * was written from the same example. Found by the Kodori integration on
 * 2026-08-03, against `ai@4.3.19`.
 *
 * Prefer `recordEmbedding` at an embedding call site: it says what the call was,
 * and it is the only place that knows 0 output tokens is correct rather than
 * missing. `recordAiSdkResult` now also reads `tokens`, so an existing caller
 * passing an embedding result gets a right answer instead of a silent zero.
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
    /** Anthropic through the AI SDK. Priced at a premium, so kept separate. */
    readonly cacheCreationInputTokens?: number;
    readonly reasoningTokens?: number;
    readonly totalTokens?: number;
    /**
     * Embeddings only. `EmbeddingModelUsage` is `{ tokens }` and nothing else —
     * there is no completion, so an embedding has no output side. Distinct from
     * `totalTokens`, which is a chat result's input-plus-output sum; the two
     * never appear together, so reading one cannot shadow the other.
     */
    readonly tokens?: number;
  };
  readonly providerMetadata?: Record<string, unknown>;
}

/**
 * Anthropic's cache counters, which the AI SDK does not put in `usage`.
 *
 * 0.2.2 added `cacheCreationInputTokens` to the usage shape and it was dead code:
 * for Anthropic through the AI SDK the counters live under
 * `providerMetadata.anthropic`, not on `usage`, so nothing ever populated
 * `cacheWriteTokens` for an AI SDK caller. Reported by the Kodori integration,
 * which had already worked around it by reading the metadata itself — a
 * workaround nobody should have needed.
 *
 * `usage` is still preferred where a version does surface it, so this is a
 * fallback rather than a replacement and both spellings keep working.
 */
function anthropicCacheCounters(result: AiSdkResultLike): {
  write?: number;
  read?: number;
} {
  const meta = result.providerMetadata?.["anthropic"];
  if (typeof meta !== "object" || meta === null) return {};
  const m = meta as Record<string, unknown>;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  return {
    ...(num(m["cacheCreationInputTokens"]) !== undefined
      ? { write: num(m["cacheCreationInputTokens"])! }
      : {}),
    ...(num(m["cacheReadInputTokens"]) !== undefined
      ? { read: num(m["cacheReadInputTokens"])! }
      : {}),
  };
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
  // Anthropic reports its cache counters in providerMetadata, not usage. Read as
  // a fallback so a caller does not have to know which of the two a given
  // provider-and-version combination uses.
  const anth = anthropicCacheCounters(result);
  const cacheRead = u?.cachedInputTokens ?? anth.read;
  const cacheWrite = u?.cacheCreationInputTokens ?? anth.write;
  // An explicit cost at the call site wins: the caller may know the real invoiced
  // figure where the Gateway only knows its own.
  const billed = opts.billedCostUsd ?? gatewayCostUsd(result);
  record({
    ...opts,
    // `tokens` last: it is the embedding shape, and a chat result never carries
    // it, so the fallback can only fire where the first two are genuinely absent.
    inputTokens: u?.inputTokens ?? u?.promptTokens ?? u?.tokens ?? 0,
    outputTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
    ...(cacheRead !== undefined ? { cachedTokens: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(u?.reasoningTokens !== undefined ? { reasoningTokens: u.reasoningTokens } : {}),
    ...(billed !== undefined ? { billedCostUsd: billed } : {}),
  });
}

/**
 * Warned at most once per process.
 *
 * An embedding whose usage cannot be read is worth saying out loud, but saying
 * it per call would print thousands of lines during a bulk index and get the
 * instrumentation removed — which is the outcome every design decision in this
 * library is trying to avoid.
 */
let warnedMissingEmbeddingUsage = false;

/**
 * Record an `embed` / `embedMany` call.
 *
 * Separate from `recordAiSdkResult` because only an embedding call site knows
 * that zero output tokens is the right answer rather than a missing one. There
 * is no completion to bill, so `outputTokens: 0` here is a fact, whereas the same
 * zero arriving from a chat result means the adapter failed to read something.
 *
 * When usage is unreadable the call is still recorded, at zero, and a warning is
 * printed once. Dropping it would lose the call entirely; recording it keeps the
 * trace shape intact and degrades one figure, which is the trade this library
 * makes everywhere else. It is deliberately *not* marked `error` — the call
 * succeeded, and a trace whose every call is flagged failed is counted as
 * producing no outcome at all, which would turn a measurement gap into a missing
 * unit of work.
 */
export function recordEmbedding(result: AiSdkResultLike, opts: AiSdkRecordOptions): void {
  const u = result.usage;
  const tokens = u?.tokens ?? u?.inputTokens ?? u?.promptTokens;

  if (tokens === undefined && !warnedMissingEmbeddingUsage) {
    warnedMissingEmbeddingUsage = true;
    console.warn(
      "[tetrameter] an embedding result carried no readable usage; recording 0 tokens. " +
        "Check the provider returns `usage.tokens` — a silent zero here understates the footprint.",
    );
  }

  const billed = opts.billedCostUsd ?? gatewayCostUsd(result);
  record({
    ...opts,
    inputTokens: tokens ?? 0,
    outputTokens: 0,
    ...(billed !== undefined ? { billedCostUsd: billed } : {}),
  });
}

/** Test seam: the once-per-process warning would otherwise leak between cases. */
export function _resetEmbeddingWarning(): void {
  warnedMissingEmbeddingUsage = false;
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

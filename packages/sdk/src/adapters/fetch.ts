/**
 * Instrumented `fetch` — for code that calls provider REST endpoints directly.
 *
 * This adapter exists because of what SiteBeacon actually does. Two of its three
 * AI integration shapes are raw `fetch`:
 *
 *   src/lib/aiAnalysis.ts              → generativelanguage.googleapis.com (Gemini)
 *   api/outreach/rewrite-templates     → Anthropic's REST API
 *
 * An SDK-wrapper-only collector would have instrumented the recognition fan-out
 * and silently missed both. Reading the codebase first is what surfaced that; a
 * design session would not have.
 *
 * ── How it reads usage without reading content ──────────────────────────────
 *
 * It clones the response and parses only the fields it needs. The clone is
 * important: consuming the original body would break the caller. And it reaches
 * for `usage`-shaped keys only — never `content`, `candidates[].content`,
 * `choices[].message` or `text`.
 *
 * On any parse failure it records what it knows (model, duration) with zero
 * tokens rather than dropping the call. A call that happened and was not counted
 * understates the footprint; a call counted at zero tokens at least appears in
 * the trace and in the call count.
 */

import { record } from "../record.js";
import { isAutoCaptureSuppressed } from "../trace.js";
import type { CallEvent } from "../types.js";

interface UsageShape {
  // OpenAI-style
  prompt_tokens?: number;
  completion_tokens?: number;
  // Anthropic-style
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  // Gemini-style
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

interface BodyShape {
  model?: string;
  usage?: UsageShape;
  usageMetadata?: UsageShape;
}

/** Pull token counts out of whichever provider dialect this is. */
export function extractUsage(body: unknown): Pick<
  CallEvent,
  "inputTokens" | "outputTokens" | "cachedTokens" | "reasoningTokens"
> & { model?: string } {
  const b = (body ?? {}) as BodyShape;
  const u: UsageShape = b.usage ?? b.usageMetadata ?? {};

  const input = u.input_tokens ?? u.prompt_tokens ?? u.promptTokenCount ?? 0;
  const output = u.output_tokens ?? u.completion_tokens ?? u.candidatesTokenCount ?? 0;
  const cached = u.cache_read_input_tokens ?? u.cachedContentTokenCount;
  const reasoning = u.thoughtsTokenCount;

  return {
    inputTokens: input,
    outputTokens: output,
    ...(cached !== undefined ? { cachedTokens: cached } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
    ...(typeof b.model === "string" ? { model: b.model } : {}),
  };
}

/** Guess the model from a provider URL when the response body omits it. */
export function modelFromUrl(url: string): string | undefined {
  // Gemini: /v1beta/models/gemini-2.5-flash:generateContent
  const gemini = /\/models\/([^:/?]+)/.exec(url);
  if (gemini?.[1]) return gemini[1];
  return undefined;
}

export interface InstrumentedFetchOptions extends Partial<Omit<CallEvent, "model">> {
  /** Only instrument URLs matching one of these. Defaults to known AI hosts. */
  readonly match?: readonly (string | RegExp)[];
  /** Fallback when neither body nor URL names a model. */
  readonly defaultModel?: string;
}

const DEFAULT_MATCH: readonly RegExp[] = [
  /api\.anthropic\.com/i,
  /api\.openai\.com/i,
  /generativelanguage\.googleapis\.com/i,
  /api\.mistral\.ai/i,
  /api\.x\.ai/i,
  /\.openai\.azure\.com/i,
  /bedrock-runtime\./i,
  /ai-gateway\.vercel\.sh/i,
  /openrouter\.ai/i,
];

function matches(url: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some((p) => (typeof p === "string" ? url.includes(p) : p.test(url)));
}

/**
 * Wrap `fetch` so provider calls record themselves.
 *
 * Non-matching requests pass through untouched and unrecorded — this is not a
 * general-purpose HTTP tracer, and instrumenting every fetch in an app would be
 * both noisy and a privacy hazard.
 */
export function instrumentedFetch(opts: InstrumentedFetchOptions = {}): typeof fetch {
  const base = globalThis.fetch;
  const patterns = opts.match ?? DEFAULT_MATCH;
  const { match: _m, defaultModel, ...attribution } = opts;

  return async function tetrameterFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (!matches(url, patterns)) return base(input, init);

    // An explicit adapter above us has already recorded this call. Recording it
    // again would double every figure it contributes to.
    if (isAutoCaptureSuppressed()) return base(input, init);

    const started = Date.now();
    let response: Response;
    try {
      response = await base(input, init);
    } catch (err) {
      record({
        ...attribution,
        model: modelFromUrl(url) ?? defaultModel ?? "unknown",
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
      });
      throw err;
    }

    const durationMs = Date.now() - started;

    // Clone before reading: consuming the original body would break the caller.
    void (async () => {
      try {
        const body = await response.clone().json();
        const usage = extractUsage(body);
        record({
          ...attribution,
          ...usage,
          model: usage.model ?? modelFromUrl(url) ?? defaultModel ?? "unknown",
          durationMs,
          ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
        });
      } catch {
        // Streaming, non-JSON, or an unexpected shape. Record the call anyway —
        // an uncounted call understates the footprint, which is the error
        // direction that matters.
        record({
          ...attribution,
          model: modelFromUrl(url) ?? defaultModel ?? "unknown",
          inputTokens: 0,
          outputTokens: 0,
          durationMs,
          error: "usage not parseable (streaming or unknown response shape)",
        });
      }
    })();

    return response;
  } as typeof fetch;
}

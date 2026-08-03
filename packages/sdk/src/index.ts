/**
 * Tetrameter SDK — the metadata-only collector.
 *
 * Records what four-resource measurement needs (model, token counts, timestamps,
 * region, attribution) and structurally cannot record anything else. There is no
 * field on `CallEvent` that holds text, and `sanitize()` strips unexpected keys
 * before a record leaves the process.
 *
 * ── Shape of a real integration ─────────────────────────────────────────────
 *
 *   import { configure, withTrace, JsonlFileSink, instrumentGenerateText }
 *     from "@kumokodo/tetrameter-sdk";
 *
 *   configure({ sink: new JsonlFileSink("./tetrameter.jsonl") });
 *   const generate = instrumentGenerateText(generateText, { team: "growth" });
 *
 *   await withTrace({ outcome: "recognition report", customer: orgId }, async () => {
 *     await Promise.all(models.map((m) => callModel(m, messages, opts)));
 *   });
 *
 * The five fan-out calls become one trace with no change to `callModel` itself.
 * The JSONL sink means this runs against real traffic today, with no backend.
 */

export { Collector, configure, record, flush, close, sanitize, _reset } from "./record.js";
export type { CollectorOptions } from "./record.js";

export {
  withTrace,
  currentTrace,
  newTraceId,
  setTraceMeta,
  suppressAutoCapture,
  isAutoCaptureSuppressed,
} from "./trace.js";

export { MemorySink, JsonlFileSink, HttpSink, MultiSink } from "./sinks.js";
export type { HttpSinkOptions } from "./sinks.js";

export { normalizeModelId, sameModel } from "./normalize.js";

export type { CallEvent, RecordedCall, TraceContext, Sink } from "./types.js";

export {
  recordAiSdkResult,
  recordEmbedding,
  instrumentGenerateText,
  _resetEmbeddingWarning,
  type AiSdkResultLike,
  type AiSdkRecordOptions,
} from "./adapters/ai-sdk.js";

export {
  instrumentedFetch,
  extractUsage,
  modelFromUrl,
  type InstrumentedFetchOptions,
} from "./adapters/fetch.js";

export {
  recordAnthropicMessage,
  instrumentAnthropicCreate,
  type AnthropicMessageLike,
  type AnthropicRecordOptions,
} from "./adapters/anthropic.js";

export { readJsonl, toTraces } from "./replay.js";

export { register, registration, traceRequest, type RegisterOptions } from "./register.js";

/**
 * Read a JSONL capture back into engine input.
 *
 * This closes the loop that makes the file sink useful: instrument an app, let it
 * run, then point the engine at the file and get a real evidence pack. No ingest
 * service, no database, no deploy.
 */

import { readFile } from "node:fs/promises";
import type { CallRecord, TraceRecord } from "@kumokodo/tetrameter-core";
import type { RecordedCall } from "./types.js";

/**
 * Parse a JSONL capture.
 *
 * A malformed final line — the signature of a process killed mid-write — is
 * skipped rather than throwing. Losing the last call is better than losing the
 * whole capture.
 */
export async function readJsonl(path: string): Promise<RecordedCall[]> {
  const text = await readFile(path, "utf8");
  const out: RecordedCall[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as RecordedCall);
    } catch {
      // Truncated write. Skip it.
    }
  }
  return out;
}

/**
 * Group recorded calls into traces the engine can consume.
 *
 * Ordered by `seq` rather than timestamp: a five-model fan-out issued in parallel
 * can carry near-identical timestamps, and the sequence number is what preserves
 * the order the application actually made them in.
 */
export function toTraces(
  calls: readonly RecordedCall[],
  outcomes: ReadonlyMap<string, { outcome?: string; outcomeCount?: number }> = new Map(),
): TraceRecord[] {
  const grouped = new Map<string, RecordedCall[]>();
  for (const call of calls) {
    const bucket = grouped.get(call.traceId);
    if (bucket) bucket.push(call);
    else grouped.set(call.traceId, [call]);
  }

  return [...grouped.entries()].map(([traceId, list]) => {
    const sorted = [...list].sort(
      (a, b) => a.seq - b.seq || a.timestamp.localeCompare(b.timestamp),
    );
    // Prefer what the capture itself recorded; the override map is for older
    // captures taken before outcome was persisted, and for reclassification.
    const recorded = sorted.find((c) => c.outcome !== undefined);
    const meta = outcomes.get(traceId);
    const outcome = meta?.outcome ?? recorded?.outcome;
    return {
      traceId,
      calls: sorted.map(toCallRecord),
      ...(outcome !== undefined ? { outcome } : {}),
      outcomeCount: meta?.outcomeCount ?? recorded?.outcomeCount ?? 1,
    };
  });
}

function toCallRecord(c: RecordedCall): CallRecord {
  return {
    id: c.id,
    traceId: c.traceId,
    timestamp: c.timestamp,
    provider: c.provider,
    model: c.model,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    ...(c.region !== undefined ? { region: c.region } : {}),
    ...(c.cachedTokens !== undefined ? { cachedTokens: c.cachedTokens } : {}),
    ...(c.reasoningTokens !== undefined ? { reasoningTokens: c.reasoningTokens } : {}),
    ...(c.durationMs !== undefined ? { durationMs: c.durationMs } : {}),
    ...(c.billedCostUsd !== undefined ? { billedCostUsd: c.billedCostUsd } : {}),
    ...(c.team !== undefined ? { team: c.team } : {}),
    ...(c.feature !== undefined ? { feature: c.feature } : {}),
    ...(c.customer !== undefined ? { customer: c.customer } : {}),
  };
}

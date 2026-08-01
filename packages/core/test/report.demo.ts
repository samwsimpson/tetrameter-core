/**
 * Renders a sample evidence pack to stdout.
 *
 *   npx vite-node test/report.demo.ts
 *
 * Exists so the artifact can be read by a human — ideally one who has sat through
 * a limited-assurance engagement and can say which section is missing.
 */

import { buildEvidencePack, renderEvidencePack } from "../src/index.js";
import type { CallRecord, TraceRecord } from "../src/index.js";

const base = {
  provider: "anthropic",
  region: "GB",
  timestamp: "2026-07-15T10:00:00.000Z",
} satisfies Partial<CallRecord>;

function agentTrace(
  id: string,
  customer: string,
  feature: string,
  team: string,
  turns: number,
  day: number,
): TraceRecord {
  const calls: CallRecord[] = Array.from({ length: turns }, (_, i) => ({
    ...base,
    id: `${id}-${i}`,
    traceId: id,
    timestamp: `2026-07-${String(day).padStart(2, "0")}T10:0${i}:00.000Z`,
    model: i === turns - 1 ? "claude-sonnet-5" : "claude-haiku-4-5",
    inputTokens: 900 + i * 1100,
    outputTokens: i === turns - 1 ? 700 : 120,
    team,
    feature,
    customer,
  }));
  return { traceId: id, calls, outcome: "support ticket resolved", outcomeCount: 1 };
}

const traces: TraceRecord[] = [
  agentTrace("t1", "acme", "triage", "support", 4, 3),
  agentTrace("t2", "acme", "triage", "support", 6, 9),
  agentTrace("t3", "globex", "triage", "support", 3, 11),
  agentTrace("t4", "globex", "summarise", "docs", 5, 18),
  agentTrace("t5", "initech", "summarise", "docs", 2, 22),
  {
    traceId: "t6",
    outcome: "support ticket resolved",
    outcomeCount: 1,
    calls: [
      {
        ...base,
        id: "t6-0",
        traceId: "t6",
        // Sub-national zone: exercises the country-level downgrade caveat.
        region: "US-CAISO",
        model: "o3-mini",
        inputTokens: 3200,
        outputTokens: 80,
        reasoningTokens: 6400,
        team: "search",
        feature: "rerank",
        customer: "acme",
      },
    ],
  },
];

console.log(
  renderEvidencePack(
    buildEvidencePack(traces, {
      entity: "KumoKodo Ltd",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      functionalUnit: "support ticket resolved",
      breakdowns: ["customer", "feature", "model"],
    }),
  ),
);

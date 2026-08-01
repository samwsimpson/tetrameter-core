/**
 * Writes a rendered evidence pack to disk so it can be opened in a browser.
 *
 *   npx vite-node test/html.demo.ts [outfile]
 *
 * Same trace corpus as report.demo.ts — the HTML and Markdown renderers must
 * always be showing the same numbers.
 */

import { writeFileSync } from "node:fs";
import { buildEvidencePack, renderEvidencePackHtml } from "../src/index.js";
import type { CallRecord, TraceRecord } from "../src/index.js";

const base = { provider: "anthropic", region: "GB" } satisfies Partial<CallRecord>;

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
  agentTrace("t6", "initech", "triage", "support", 4, 25),
  {
    traceId: "t7",
    outcome: "support ticket resolved",
    outcomeCount: 1,
    calls: [
      {
        ...base,
        id: "t7-0",
        traceId: "t7",
        timestamp: "2026-07-27T10:00:00.000Z",
        // Sub-national zone and a reasoning model: exercises two caveat paths.
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
  {
    traceId: "t8",
    outcome: "document processed",
    outcomeCount: 1,
    calls: [
      {
        ...base,
        id: "t8-0",
        traceId: "t8",
        timestamp: "2026-07-28T11:00:00.000Z",
        // Self-hosted on a benchmarked open-weight model: reaches Tier 2, so the
        // report shows a genuinely mixed tier distribution rather than all Tier 1.
        model: "meta-llama/llama-3.1-70b-instruct",
        provider: "self-hosted",
        inputTokens: 5000,
        outputTokens: 1800,
        team: "docs",
        feature: "summarise",
        customer: "globex",
      },
    ],
  },
];

const html = renderEvidencePackHtml(
  buildEvidencePack(traces, {
    entity: "KumoKodo Ltd",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    functionalUnit: "support ticket resolved",
    breakdowns: ["customer", "feature", "model"],
  }),
);

const out = process.argv[2] ?? "evidence-pack.html";
writeFileSync(out, html, "utf8");
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);

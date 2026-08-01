/**
 * The whole loop, with no backend.
 *
 *   npx vite-node test/e2e.demo.ts
 *
 * Simulates SiteBeacon's recognition report — five models fanned out per audit,
 * through the Vercel AI Gateway — captures to JSONL, then replays the file
 * through the engine and prints the evidence-pack totals.
 *
 * This is the path to the first real case study: instrument `callModel`, let it
 * run, point the engine at the file. No ingest service, no database, no deploy.
 */

import { rm } from "node:fs/promises";
import {
  configure,
  withTrace,
  JsonlFileSink,
  instrumentGenerateText,
  readJsonl,
  toTraces,
  close,
} from "../src/index.js";
import {
  buildEvidencePack,
  formatQuantity,
  rollup,
} from "@kumokodo/tetrameter-core";

const FILE = "./.tetrameter-demo.jsonl";
await rm(FILE, { force: true });

configure({ sink: new JsonlFileSink(FILE), batchSize: 5, flushIntervalMs: 100 });

// SiteBeacon's actual default fleet, verbatim from src/lib/recognition/providers.ts.
const FLEET = [
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash",
  "perplexity/sonar",
  "xai/grok-4.1-fast-non-reasoning",
];

// Stand-in for `generateText` from `ai` v7.
const fakeGenerate = async ({ model }: { model: string }) => ({
  usage: {
    inputTokens: 900 + Math.round(model.length * 37),
    outputTokens: 260 + Math.round(model.length * 11),
  },
});
const generate = instrumentGenerateText(fakeGenerate, { team: "growth", feature: "recognition" });

const AUDITS = [
  { customer: "acme-corp", domain: "acme.example" },
  { customer: "globex", domain: "globex.example" },
  { customer: "initech", domain: "initech.example" },
];

const outcomes = new Map<string, { outcome: string; outcomeCount: number }>();

for (const audit of AUDITS) {
  await withTrace({ outcome: "recognition report", customer: audit.customer }, async function () {
    const { currentTrace } = await import("../src/index.js");
    outcomes.set(currentTrace()!.traceId, { outcome: "recognition report", outcomeCount: 1 });
    // The fan-out. callModel knows nothing about the trace it belongs to.
    await Promise.all(FLEET.map((model) => generate({ model })));
  });
}

await close();

// ── Replay ────────────────────────────────────────────────────────────────────
const calls = await readJsonl(FILE);
const traces = toTraces(calls, outcomes);

console.log(`\ncaptured ${calls.length} calls in ${traces.length} traces (no backend involved)\n`);

const pack = buildEvidencePack(traces, {
  entity: "SiteBeacon",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-01",
  functionalUnit: "recognition report",
  breakdowns: ["customer", "model"],
});

console.log("  cost   ", formatQuantity(pack.totals.cost, { precision: 3 }));
console.log("  energy ", formatQuantity(pack.totals.energy));
console.log("  carbon ", formatQuantity(pack.totals.carbon));
console.log("  water  ", formatQuantity(pack.totals.water));
console.log("  land   ", formatQuantity(pack.totals.land));
console.log("  SCI    ", pack.totals.sci ? formatQuantity(pack.totals.sci) : "—", "per report");

console.log("\n  by customer:");
for (const g of rollup(traces, { by: ["customer"] })) {
  console.log(
    `    ${(g.key["customer"] ?? "—").padEnd(12)} ${g.traces} report(s)  ` +
      `${formatQuantity(g.footprint.cost, { precision: 3 })}  ${formatQuantity(g.footprint.carbon)}`,
  );
}

console.log("\n  by model (per call — model varies within a trace):");
for (const g of rollup(traces, { by: ["model"] })) {
  console.log(
    `    ${(g.key["model"] ?? "—").padEnd(34)} ${String(g.calls).padStart(2)} calls  ` +
      formatQuantity(g.footprint.cost, { precision: 3 }),
  );
}

console.log("\n  limitations the pack generated about itself:");
for (const c of pack.caveats.slice(0, 3)) console.log(`    - ${c.slice(0, 110)}…`);

await rm(FILE, { force: true });
console.log();

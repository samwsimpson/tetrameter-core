/**
 * A runnable walk-through of one agentic trace, printed to stdout.
 *
 *   npx tsx test/smoke.demo.ts     (or: npx vite-node test/smoke.demo.ts)
 *
 * Exists so the numbers are visible and arguable rather than buried in assertions.
 * If a figure here looks wrong to you, it might be — say so, and we change the
 * factor set and log a restatement.
 */

import {
  computeTrace,
  formatQuantity,
  sci,
  describeTier,
  FACTOR_SET_VERSION,
} from "../src/index.js";
import type { CallRecord } from "../src/index.js";

const base = {
  timestamp: "2026-07-31T10:00:00.000Z",
  provider: "anthropic",
  region: "US-CAISO",
  team: "support",
  feature: "ticket-triage",
  customer: "acme-corp",
} satisfies Partial<CallRecord>;

// A support-triage agent resolving one ticket. Context grows every turn because
// the full history is resent, and it calls the same lookup tool twice.
const calls: CallRecord[] = [
  { ...base, id: "1", traceId: "t-9001", model: "claude-sonnet-5", inputTokens: 1_200, outputTokens: 180 },
  { ...base, id: "2", traceId: "t-9001", model: "claude-sonnet-5", inputTokens: 2_400, outputTokens: 90 },
  { ...base, id: "3", traceId: "t-9001", model: "claude-sonnet-5", inputTokens: 3_800, outputTokens: 90 },
  { ...base, id: "4", traceId: "t-9001", model: "o3-mini", inputTokens: 4_100, outputTokens: 60, reasoningTokens: 5_400 },
  { ...base, id: "5", traceId: "t-9001", model: "claude-sonnet-5", inputTokens: 5_200, outputTokens: 640 },
];

const trace = { traceId: "t-9001", calls, outcome: "ticket resolved", outcomeCount: 1 };
const footprint = computeTrace(trace);

console.log(`\nFactor set ${FACTOR_SET_VERSION}\n`);
console.log(`Trace ${footprint.traceId} — "${footprint.outcome}"`);
console.log(`  calls              ${footprint.callCount}`);
console.log(`  tokens             ${footprint.totalTokens.toLocaleString()}`);
console.log(
  `  invisible tokens   ${footprint.invisibleTokens.toLocaleString()} ` +
    `(${(footprint.invisibleShare * 100).toFixed(0)}% — billed, never seen by the user)`,
);
console.log(`\n  cost               ${formatQuantity(footprint.cost, { precision: 3 })}`);
console.log(`  energy             ${formatQuantity(footprint.energy)}`);
console.log(`  carbon             ${formatQuantity(footprint.carbon)}`);
console.log(`  water              ${formatQuantity(footprint.water)}`);
console.log(`  SCI                ${formatQuantity(sci(footprint, footprint.outcomeCount))}`);

const tier = describeTier(footprint.tier);
console.log(`\n  evidence           Tier ${tier.tier} — ${tier.label}`);
console.log(`                     ${tier.description}`);

// Same trace on the marginal signal — what a reduction claim must use.
//
// Note the explicit opt-in. Every marginal factor we hold is inferred from fossil
// generation mix, not a measured MOER, so the library refuses to hand one to a
// reduction claim by accident. Deliberate friction.
console.log(`\n  carbon (average)   ${formatQuantity(footprint.carbon)}   ← for the inventory`);
try {
  computeTrace(trace, { signal: "marginal" });
  console.log("  (unreachable — marginal should have required an opt-in)");
} catch {
  console.log(`  carbon (marginal)  refused without an explicit opt-in — we only hold an estimate`);
}

const marginal = computeTrace(trace, { signal: "marginal", allowEstimatedMarginal: true });
console.log(`                     ${formatQuantity(marginal.carbon)}   ← once opted in`);
console.log(
  `                     ${(marginal.carbon.value / footprint.carbon.value).toFixed(2)}× apart. ` +
    `Reporting a saving on the wrong signal is how claims get overstated.`,
);


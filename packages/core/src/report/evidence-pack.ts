/**
 * The auditor's evidence pack.
 *
 * This is the paid tier and the thing an observability vendor cannot bolt on,
 * because it is not a feature — it is a discipline. A carbon column in a
 * dashboard is a fortnight of work. An artifact that survives an ISAE 3410
 * limited-assurance engagement is a different object.
 *
 * ── What assurance actually tests ───────────────────────────────────────────
 *
 * Under ISAE 3410, limited assurance means the practitioner concludes "nothing
 * has come to our attention…" on the basis of analytical procedures and enquiry
 * rather than independent verification of every data point. In practice they test
 * three things:
 *
 *   1. Methodology documentation  → §methodology, §boundaries
 *   2. Traceability from the reported figure back to raw data
 *                                 → §scope, §breakdowns, every Quantity's sources
 *   3. Emission factor testing    → §factorRegister, with version and retrieval date
 *
 * And the unlock: ISAE 3410 explicitly acknowledges estimation uncertainty,
 * requires it to be *disclosed*, and states this does not preclude GHG emissions
 * from being an appropriate subject matter unless the uncertainty is material.
 *
 * So the pack does not try to look confident. It states its ranges, its tier
 * distribution and its own weaknesses, because that is what makes it defensible.
 *
 * ── The pack criticises itself ──────────────────────────────────────────────
 *
 * `caveats` are generated from the actual data, not written by hand. If 90% of
 * the emissions sit at Tier 1, the pack says so without anybody remembering to.
 * A limitation nobody wrote down is the one that surfaces in the assurance
 * meeting.
 */

import { formatQuantity, type Quantity } from "../quantity.js";
import { TIERS, type Tier } from "../tiers.js";
import type { FactorRef, Restatement } from "../provenance.js";
import type { ComputeOptions, TraceRecord } from "../types.js";
import { computeTrace } from "../compute/trace.js";
import {
  rollup,
  rollupTotal,
  CALL_LEVEL_DIMENSIONS,
  type Dimension,
  type RollupGroup,
} from "../compute/rollup.js";
import { FACTOR_SET_VERSION, FACTOR_SET_NOTES, RESTATEMENTS } from "../factors/index.js";

export interface EvidencePackOptions extends ComputeOptions {
  /** Reporting entity, as it should appear in the disclosure. */
  readonly entity: string;
  /** ISO dates bounding the reporting period. */
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Breakdowns to include. Defaults to team, feature, customer, model. */
  readonly breakdowns?: readonly Dimension[];
  /** Functional unit name, e.g. "support ticket resolved". */
  readonly functionalUnit?: string;
}

export interface EvidencePack {
  readonly meta: {
    readonly entity: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly factorSetVersion: string;
    readonly gridSignal: string;
    readonly marginalEstimated: boolean;
    readonly functionalUnit?: string;
  };
  readonly scope: {
    readonly traces: number;
    readonly calls: number;
    readonly tokens: number;
    readonly invisibleTokens: number;
    readonly outcomes: number;
  };
  readonly totals: {
    readonly energy: Quantity;
    readonly carbon: Quantity;
    readonly water: Quantity;
    readonly land: Quantity;
    readonly cost: Quantity;
    readonly sci?: Quantity;
  };
  readonly tierDistribution: RollupGroup["tierMix"];
  readonly tierByResource: RollupGroup["tierByResource"];
  readonly breakdowns: Readonly<Record<string, readonly RollupGroup[]>>;
  readonly factorRegister: readonly FactorRef[];
  readonly restatements: readonly Restatement[];
  readonly methodology: string;
  /** Generated from the data, not authored. */
  readonly caveats: readonly string[];
}

function collectFactors(traces: readonly TraceRecord[], opts: ComputeOptions): FactorRef[] {
  const seen = new Map<string, FactorRef>();
  for (const trace of traces) {
    const f = computeTrace(trace, opts);
    for (const q of [f.energy, f.carbon, f.water, f.land, f.cost]) {
      for (const ref of q.sources) seen.set(`${ref.id}@${ref.version}`, ref);
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Generate the pack's own limitations from what is actually in it.
 *
 * Ordered by how likely each is to matter to an assurance provider, not by how
 * comfortable it is to read.
 */
function generateCaveats(
  pack: Omit<EvidencePack, "caveats">,
  factors: readonly FactorRef[],
): string[] {
  const out: string[] = [];
  const t = pack.tierDistribution;

  const tier1Carbon = t.carbonShares[1];
  if (tier1Carbon > 0.5) {
    out.push(
      `${(tier1Carbon * 100).toFixed(0)}% of reported emissions rest on Tier 1 evidence — ` +
        `class-average model energy and annual grid averages. Provider transparency, not method, ` +
        `is the binding constraint: no commercial LLM API publishes per-request energy.`,
    );
  }

  if (t.counts[3] === 0 && t.counts[4] === 0) {
    out.push(
      "No figure in this report rests on measured energy. All energy is estimated from published " +
        "benchmarks, because the providers used do not disclose per-request consumption.",
    );
  }

  // Name the binding constraint rather than leaving a reader to infer it from a
  // uniformly Tier 1 headline. If energy is better evidenced than carbon, the
  // grid factor is what is holding the report back — and that is actionable.
  // Compared on trace share, not carbon share: this is a statement about how much
  // of the work is well-evidenced, and a single heavy trace should not mask the
  // fact that the method improved across most of the corpus.
  const energyBetter = pack.tierByResource.energy.shares[1];
  const carbonAtT1 = pack.tierByResource.carbon.shares[1];
  if (carbonAtT1 > energyBetter + 0.05) {
    out.push(
      `Model energy is better evidenced than the emissions derived from it: ` +
        `${pct(1 - energyBetter)} of energy sits above Tier 1 while only ${pct(1 - carbonAtT1)} of ` +
        `carbon does. The grid intensity factor is the binding constraint on this report, not the ` +
        `model data — live time-resolved grid data would lift the carbon figures directly.`,
    );
  }

  if (pack.meta.gridSignal === "marginal" && pack.meta.marginalEstimated) {
    out.push(
      "Marginal grid intensity here is inferred from fossil generation mix, not a measured " +
        "marginal operating emissions rate. Reduction claims built on it should be presented as " +
        "estimates with the stated range.",
    );
  }

  if (pack.meta.gridSignal === "average") {
    out.push(
      "Grid intensity is location-based annual average, which is the correct basis for an " +
        "inventory. It is NOT a valid basis for claiming avoided emissions — a reduction claim " +
        "requires the marginal signal.",
    );
  }

  /*
   * Count regions, not factor references.
   *
   * Each resolved region emits two refs — the grid intensity and the land-use
   * factor derived from the same zone — so counting refs reported one region as
   * "2 grid factor(s)". An inflated count in a document whose purpose is
   * accuracy is a small error that invites doubt about the large numbers.
   */
  const regionsWhere = (match: string): number =>
    new Set(
      factors.filter((f) => f.note?.includes(match)).map((f) => f.id.replace(/\.land$/, "")),
    ).size;

  const subNational = regionsWhere("sub-national");
  if (subNational > 0) {
    out.push(
      `${subNational} region(s) were resolved from a sub-national zone to country level. ` +
        `Sub-national grids can differ substantially from the national average.`,
    );
  }

  const cloudMapped = regionsWhere("from cloud region");
  if (cloudMapped > 0) {
    out.push(
      `${cloudMapped} region(s) were resolved from a cloud provider's region code to the ` +
        `country that region sits in. The grid actually serving a given data centre can differ ` +
        `substantially from its national average.`,
    );
  }

  /*
   * Unlocated consumption is a limitation about the *inputs*, not the method,
   * and it is the one a reader is least able to infer for themselves. A figure
   * computed on the global average looks identical to one computed on a located
   * grid; only this line distinguishes them.
   */
  const unlocated = regionsWhere("global average was used");
  if (unlocated > 0) {
    out.push(
      `Consumption was measured against the global average because no region was supplied or the ` +
        `region given was not recognised. National grid intensities range from under ` +
        `30 gCO₂e/kWh to over 600, so these figures carry error far exceeding the stated band. ` +
        `Supplying the region each workload runs in is the single highest-value correction ` +
        `available to this inventory.`,
    );
  }

  if (factors.some((f) => f.kind === "grid-intensity")) {
    out.push(
      "Grid factors are annual averages and are not time-resolved. Intraday carbon intensity " +
        "commonly varies two- to threefold, so figures for workloads concentrated at a particular " +
        "time of day carry additional unquantified error.",
    );
  }

  const invisibleShare =
    pack.scope.tokens > 0 ? pack.scope.invisibleTokens / pack.scope.tokens : 0;
  if (invisibleShare > 0.15) {
    out.push(
      `${(invisibleShare * 100).toFixed(0)}% of tokens in scope were billed but never surfaced to ` +
        `an end user — model reasoning and intermediate agent steps. These are included in full.`,
    );
  }

  if (pack.restatements.length > 0) {
    out.push(
      `${pack.restatements.length} factor restatement(s) apply to this factor set. Figures are ` +
        `not comparable with reports generated against earlier versions without restating those.`,
    );
  }

  const est = factors.filter((f) => f.kind === "pricing" && f.id.includes("class."));
  if (est.length > 0) {
    out.push(
      `${est.length} pricing factor(s) fell back to a class median because the model was absent ` +
        `from the price catalogue. Cost figures for those calls are indicative.`,
    );
  }

  return out;
}

const BOUNDARIES = [
  "**Included.** Energy consumed serving inference requests: accelerator draw, host CPU/RAM and",
  "networking, amortised idle and reserve capacity, and datacentre facility overhead (PUE). Carbon",
  "from that energy at the stated grid intensity, plus an amortised share of hardware manufacturing",
  "(embodied). Water on-site (evaporative cooling) and off-site (electricity generation), reported",
  "together. Cost as billed where known, else public list price.",
  "",
  "**Excluded.** Model training. End-user device energy. Network transit beyond the datacentre.",
  "Employee and office emissions. These belong in other parts of a corporate inventory and are out",
  "of scope for AI inference under Scope 3 Category 1.",
].join(" ");

export function buildEvidencePack(
  traces: readonly TraceRecord[],
  opts: EvidencePackOptions,
): EvidencePack {
  const total = rollupTotal(traces, opts);
  const dims = opts.breakdowns ?? (["team", "feature", "customer", "model"] as const);

  const breakdowns: Record<string, readonly RollupGroup[]> = {};
  for (const dim of dims) breakdowns[dim] = rollup(traces, { ...opts, by: [dim] });

  const factorRegister = collectFactors(traces, opts);

  const base: Omit<EvidencePack, "caveats"> = {
    meta: {
      entity: opts.entity,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      factorSetVersion: FACTOR_SET_VERSION,
      gridSignal: opts.signal ?? "average",
      marginalEstimated: (opts.signal ?? "average") === "marginal" && !!opts.allowEstimatedMarginal,
      ...(opts.functionalUnit !== undefined ? { functionalUnit: opts.functionalUnit } : {}),
    },
    scope: {
      traces: total.traces,
      calls: total.calls,
      tokens: total.tokens,
      invisibleTokens: total.invisibleTokens,
      outcomes: total.outcomes,
    },
    totals: {
      energy: total.footprint.energy,
      carbon: total.footprint.carbon,
      water: total.footprint.water,
      land: total.footprint.land,
      cost: total.footprint.cost,
      ...(total.sci !== undefined ? { sci: total.sci } : {}),
    },
    tierDistribution: total.tierMix,
    tierByResource: total.tierByResource,
    breakdowns,
    factorRegister,
    restatements: RESTATEMENTS.entries,
    methodology: FACTOR_SET_NOTES,
  };

  return { ...base, caveats: generateCaveats(base, factorRegister) };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function breakdownTable(dim: Dimension, groups: readonly RollupGroup[]): string {
  // Model, provider and region vary within a single trace — an agent runs Haiku
  // for intermediate turns and Sonnet for the answer — so those breakdowns count
  // calls. Labelling them "traces" would overstate the unit and imply outcomes
  // can be attributed to one model, which they cannot.
  const perCall = CALL_LEVEL_DIMENSIONS.has(dim);
  const unit = perCall ? "calls" : "traces";

  const rows = groups
    .slice(0, 25)
    .map((g) => {
      const label = g.key[dim] ?? "—";
      const count = perCall ? g.calls : g.traces;
      return `| ${label} | ${count} | ${formatQuantity(g.footprint.cost, { precision: 3 })} | ${formatQuantity(g.footprint.carbon)} | ${formatQuantity(g.footprint.water)} | ${g.footprint.tier} |`;
    })
    .join("\n");

  const omitted = groups.length > 25 ? `\n\n_${groups.length - 25} further rows omitted._` : "";
  const note = perCall
    ? `\n\n_Counted per call: ${dim} varies within a trace, so outcomes and SCI are not attributed here._`
    : "";

  return [
    `### By ${dim}`,
    "",
    `| ${dim} | ${unit} | cost | carbon | water | tier |`,
    "|---|---:|---:|---:|---:|---:|",
    rows,
    note,
    omitted,
  ].join("\n");
}

/**
 * Render the pack as Markdown for the assurance file.
 *
 * Every figure is a range where the band is wide, because that is what
 * `formatQuantity` does and the report has no business overriding it.
 */
export function renderEvidencePack(pack: EvidencePack): string {
  const t = pack.tierDistribution;
  const out: string[] = [];
  const w = (s = "") => out.push(s);

  w(`# AI inference emissions — evidence pack`);
  w();
  w(`**Entity:** ${pack.meta.entity}  `);
  w(`**Period:** ${pack.meta.periodStart} to ${pack.meta.periodEnd}  `);
  w(`**Factor set:** \`${pack.meta.factorSetVersion}\`  `);
  w(
    `**Grid signal:** ${pack.meta.gridSignal}${pack.meta.marginalEstimated ? " (inferred, not measured)" : ""}  `,
  );
  w(`**GHG Protocol classification:** Scope 3, Category 1 — purchased goods and services`);
  w();
  w(
    `> This pack is designed to be checked, not believed. Every figure carries an uncertainty ` +
      `range, an evidence tier and the factors it was derived from. Section 6 lists the ` +
      `limitations of this report, generated from its own data rather than authored.`,
  );
  w();

  w(`## 1. Scope`);
  w();
  w(`| | |`);
  w(`|---|---:|`);
  w(`| Traces (business outcomes) | ${pack.scope.traces.toLocaleString()} |`);
  w(`| Model calls | ${pack.scope.calls.toLocaleString()} |`);
  w(`| Tokens | ${pack.scope.tokens.toLocaleString()} |`);
  w(
    `| — of which billed but never user-visible | ${pack.scope.invisibleTokens.toLocaleString()} |`,
  );
  w(`| Functional units | ${pack.scope.outcomes.toLocaleString()} |`);
  w();

  w(`## 2. Totals`);
  w();
  w(`| Resource | Reported |`);
  w(`|---|---|`);
  w(`| Energy | ${formatQuantity(pack.totals.energy)} |`);
  w(`| **Carbon** | **${formatQuantity(pack.totals.carbon)}** |`);
  w(`| Water | ${formatQuantity(pack.totals.water)} |`);
  w(`| Land | ${formatQuantity(pack.totals.land)} |`);
  w(`| Cost | ${formatQuantity(pack.totals.cost, { precision: 4 })} |`);
  if (pack.totals.sci) {
    w(
      `| SCI per ${pack.meta.functionalUnit ?? "functional unit"} | ${formatQuantity(pack.totals.sci)} |`,
    );
  }
  w();

  w(`## 3. Evidence tiers`);
  w();
  w(
    `Tiers follow the four-tier framework for AI inference under Scope 3 Category 1. ` +
      `The carbon-weighted share matters more than the count: a report can be mostly Tier 2 by ` +
      `trace while most of its emissions sit at Tier 1.`,
  );
  w();
  w(`| Tier | Label | Traces | Share | Share of carbon |`);
  w(`|---|---|---:|---:|---:|`);
  for (const tier of [1, 2, 3, 4] as Tier[]) {
    if (t.counts[tier] === 0) continue;
    w(
      `| ${tier} | ${TIERS[tier].label} | ${t.counts[tier]} | ${pct(t.shares[tier])} | ${pct(t.carbonShares[tier])} |`,
    );
  }
  w();
  w(
    `The composite tier is the weakest link across all four resources, so it hides where the ` +
      `constraint binds. Per resource, by trace share:`,
  );
  w();
  w(`| Resource | Tier 1 | Tier 2 | Tier 3 | Tier 4 |`);
  w(`|---|---:|---:|---:|---:|`);
  for (const [name, dist] of Object.entries(pack.tierByResource)) {
    w(
      `| ${name} | ${pct(dist.shares[1])} | ${pct(dist.shares[2])} | ${pct(dist.shares[3])} | ${pct(dist.shares[4])} |`,
    );
  }
  w();

  w(`## 4. Breakdowns`);
  w();
  for (const [dim, groups] of Object.entries(pack.breakdowns)) {
    w(breakdownTable(dim as Dimension, groups));
    w();
  }

  w(`## 5. Methodology and boundaries`);
  w();
  w(pack.methodology);
  w();
  w(BOUNDARIES);
  w();

  w(`## 6. Limitations`);
  w();
  w(`_Generated from this report's own data._`);
  w();
  for (const c of pack.caveats) w(`- ${c}`);
  w();

  w(`## 7. Factor register`);
  w();
  w(`Every coefficient used, with the version and date it was retrieved.`);
  w();
  w(`| Factor | Kind | Version | Source | Retrieved |`);
  w(`|---|---|---|---|---|`);
  for (const f of pack.factorRegister) {
    w(
      `| \`${f.id}\` | ${f.kind} | ${f.version} | ${f.source.replace(/\|/g, "\\|")} | ${f.retrieved} |`,
    );
  }
  w();

  if (pack.restatements.length > 0) {
    w(`## 8. Restatements`);
    w();
    w(
      `Factor changes shipped in this set. Figures are not comparable with reports generated ` +
        `against earlier versions unless those are restated.`,
    );
    w();
    w(`| Factor | From | To | Materiality | Reason |`);
    w(`|---|---|---|---:|---|`);
    for (const r of pack.restatements) {
      const m = r.materialityEstimate;
      w(
        `| \`${r.factorId}\` | ${r.fromVersion} | ${r.toVersion} | ${m === undefined ? "—" : pct(m)} | ${r.reason.replace(/\|/g, "\\|")} |`,
      );
    }
    w();
  }

  return out.join("\n");
}

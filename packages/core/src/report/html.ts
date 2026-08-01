/**
 * HTML rendering of the evidence pack.
 *
 * The Markdown renderer is for a repo and a diff. This is for the person who has
 * to act on it — and per PRODUCT-EDGE §4.3, the artifact an engineering lead
 * forwards to a CFO is the one that earns the renewal. So it is designed as a
 * report, not a dashboard: document register, generous measure, no chrome.
 *
 * ── The one visual idea ─────────────────────────────────────────────────────
 *
 * Every number we produce is a range. So every number is *drawn* as a range: a
 * track from zero, a filled span from low to high, and a tick at the central
 * estimate. The width of that span is the honest content of the figure, and it
 * is the thing no competitor's dashboard shows, because they all render point
 * values they cannot support.
 *
 * A reader should be able to see, without reading a word of methodology, that a
 * Tier 1 figure is a wide smear and a Tier 3 figure is nearly a point.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 *
 * Tier is ordinal — evidence strength — so it takes a sequential single-hue ramp
 * rather than categorical hues, with emphasis increasing as evidence strengthens.
 * Deliberately NOT a red-to-green status scale: Tier 1 is not "bad", it is less
 * precise, and colouring it as a failure would editorialise a measurement.
 *
 * Both ramps and the two accents are validated for lightness banding, chroma
 * floor, CVD separation and contrast against their own surface.
 *
 * No external resources: strict CSP, so all CSS is inline and there are no
 * webfonts, scripts or images.
 */

import type { EvidencePack } from "./evidence-pack.js";
import { formatQuantity, type Quantity } from "../quantity.js";
import { TIERS, type Tier } from "../tiers.js";
import { CALL_LEVEL_DIMENSIONS, type Dimension, type RollupGroup } from "../compute/rollup.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * A range bar: track from zero to `scaleMax`, span from low to high, tick at the
 * central estimate.
 */
function rangeBar(q: Quantity, scaleMax: number, tone: "carbon" | "cost" | "neutral"): string {
  const max = scaleMax > 0 ? scaleMax : 1;
  const clamp = (n: number) => Math.max(0, Math.min(100, (n / max) * 100));
  const left = clamp(q.low);
  const right = clamp(q.high);
  const width = Math.max(right - left, 0.6);
  const tick = clamp(q.value);
  const title = `${q.low.toPrecision(3)} – ${q.high.toPrecision(3)} ${q.unit} (central ${q.value.toPrecision(3)}, tier ${q.tier})`;

  return (
    `<span class="rb rb-${tone}" title="${esc(title)}">` +
    `<span class="rb-track"></span>` +
    `<span class="rb-span" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></span>` +
    `<span class="rb-tick" style="left:${tick.toFixed(2)}%"></span>` +
    `</span>`
  );
}

function stackedTierBar(shares: Readonly<Record<Tier, number>>, label: string): string {
  const segments = ([1, 2, 3, 4] as Tier[])
    .filter((t) => shares[t] > 0)
    .map(
      (t) =>
        `<span class="seg seg-t${t}" style="flex:${shares[t]}" title="Tier ${t} — ${TIERS[t].label}: ${pct(shares[t])}">` +
        (shares[t] > 0.12 ? `<span class="seg-label">${pct(shares[t])}</span>` : "") +
        `</span>`,
    )
    .join("");
  return `<div class="stack-row"><span class="stack-label">${esc(label)}</span><span class="stack">${segments}</span></div>`;
}

function breakdownSection(dim: Dimension, groups: readonly RollupGroup[]): string {
  const perCall = CALL_LEVEL_DIMENSIONS.has(dim);
  const unit = perCall ? "calls" : "traces";
  const rows = groups.slice(0, 20);
  const scale = Math.max(...rows.map((g) => g.footprint.carbon.high), 0);

  const body = rows
    .map((g) => {
      const label = g.key[dim] ?? "—";
      const count = perCall ? g.calls : g.traces;
      return (
        `<tr>` +
        `<td class="lbl">${esc(label)}</td>` +
        `<td class="n">${count.toLocaleString()}</td>` +
        `<td class="n money">${esc(formatQuantity(g.footprint.cost, { precision: 3 }))}</td>` +
        `<td class="bar">${rangeBar(g.footprint.carbon, scale, "carbon")}</td>` +
        `<td class="n">${esc(formatQuantity(g.footprint.carbon))}</td>` +
        `<td class="n"><span class="tier tier-${g.footprint.tier}">T${g.footprint.tier}</span></td>` +
        `</tr>`
      );
    })
    .join("");

  const note = perCall
    ? `<p class="fine">Counted per call: ${esc(dim)} varies within a trace, so outcomes and SCI are not attributed here.</p>`
    : "";
  const omitted =
    groups.length > 20 ? `<p class="fine">${groups.length - 20} further rows omitted.</p>` : "";

  return (
    `<h3>By ${esc(dim)}</h3>` +
    `<div class="tw"><table>` +
    `<thead><tr><th>${esc(dim)}</th><th class="n">${unit}</th><th class="n">cost</th>` +
    `<th class="bar">carbon range</th><th class="n">carbon</th><th class="n">tier</th></tr></thead>` +
    `<tbody>${body}</tbody></table></div>${note}${omitted}`
  );
}

function totalCard(
  label: string,
  q: Quantity,
  tone: "carbon" | "cost" | "neutral",
  emphasis = false,
): string {
  return (
    `<div class="card${emphasis ? " card-lead" : ""}">` +
    `<div class="card-k">${esc(label)}</div>` +
    `<div class="card-v">${esc(formatQuantity(q))}</div>` +
    `<div class="card-bar">${rangeBar(q, q.high, tone)}</div>` +
    `<div class="card-n">central ${esc(q.value.toPrecision(3))} · tier ${q.tier}</div>` +
    `</div>`
  );
}

const CSS = `
:root{
  --paper:#FAFBFA; --raised:#FFFFFF; --sunk:#F1F4F3;
  --ink:#0E1A19; --body:#263433; --muted:#5B6A69;
  --rule:#DCE3E1; --rule-soft:#E9EEED;
  --carbon:#0D9488; --cost:#C2641F;
  --t1:#7FBAB2; --t2:#4E9B94; --t3:#25776F; --t4:#08544F;
  --warn-bg:#FBF3E7; --warn-edge:#C2641F;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --serif:Georgia,"Iowan Old Style","Palatino Linotype","Times New Roman",serif;
  --mono:ui-monospace,"Cascadia Mono","SF Mono","JetBrains Mono",Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#0B1211; --raised:#121C1B; --sunk:#16211F;
    --ink:#EEF3F2; --body:#C3CFCD; --muted:#8A9997;
    --rule:#263432; --rule-soft:#1D2A28;
    --carbon:#1FA394; --cost:#CB7C36;
    --t1:#0E5F58; --t2:#17857B; --t3:#2FAEA0; --t4:#5FD0C2;
    --warn-bg:#241A11; --warn-edge:#CB7C36;
  }
}
:root[data-theme="dark"]{
  --paper:#0B1211; --raised:#121C1B; --sunk:#16211F;
  --ink:#EEF3F2; --body:#C3CFCD; --muted:#8A9997;
  --rule:#263432; --rule-soft:#1D2A28;
  --carbon:#1FA394; --cost:#CB7C36;
  --t1:#0E5F58; --t2:#17857B; --t3:#2FAEA0; --t4:#5FD0C2;
  --warn-bg:#241A11; --warn-edge:#CB7C36;
}
:root[data-theme="light"]{
  --paper:#FAFBFA; --raised:#FFFFFF; --sunk:#F1F4F3;
  --ink:#0E1A19; --body:#263433; --muted:#5B6A69;
  --rule:#DCE3E1; --rule-soft:#E9EEED;
  --carbon:#0D9488; --cost:#C2641F;
  --t1:#7FBAB2; --t2:#4E9B94; --t3:#25776F; --t4:#08544F;
  --warn-bg:#FBF3E7; --warn-edge:#C2641F;
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

body{background:var(--paper);color:var(--body);font-family:var(--serif);font-size:16.5px;line-height:1.65;-webkit-font-smoothing:antialiased}
.doc{max-width:940px;margin:0 auto;padding:0 24px 96px}

.head{border-bottom:2px solid var(--ink);padding:52px 0 22px;margin-bottom:26px}
.eyebrow{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--carbon);margin-bottom:16px}
h1{font-family:var(--sans);font-weight:800;letter-spacing:-.032em;line-height:1.02;font-size:clamp(30px,5vw,46px);color:var(--ink);text-wrap:balance;margin-bottom:20px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px 26px;font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.facts b{display:block;color:var(--ink);font-weight:600;font-size:12.5px;margin-top:3px}

.pull{background:var(--sunk);border-left:3px solid var(--carbon);padding:16px 20px;margin:24px 0 0;font-size:15.5px}

h2{font-family:var(--sans);font-weight:780;letter-spacing:-.026em;font-size:23px;color:var(--ink);
   padding-bottom:11px;border-bottom:1px solid var(--rule);margin:52px 0 20px;display:grid;
   grid-template-columns:auto 1fr;gap:12px;align-items:baseline}
h2 .num{font-family:var(--mono);font-size:12px;font-weight:500;color:var(--carbon)}
h3{font-family:var(--sans);font-weight:700;font-size:16px;color:var(--ink);margin:26px 0 10px}
p{margin-bottom:14px;max-width:68ch}
.fine{font-size:13px;color:var(--muted);font-family:var(--sans);margin:6px 0 0}

.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)}
.card{background:var(--raised);padding:16px 18px 18px}
.card-lead{background:var(--sunk)}
.card-k{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);margin-bottom:9px}
.card-v{font-family:var(--sans);font-weight:750;font-size:20px;letter-spacing:-.02em;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.2}
.card-bar{margin:12px 0 8px}
.card-n{font-family:var(--mono);font-size:10.5px;color:var(--muted)}

.rb{position:relative;display:block;height:9px}
.rb-track{position:absolute;inset:0;background:var(--rule-soft);border-radius:4px}
.rb-span{position:absolute;top:0;height:9px;border-radius:4px;background:var(--carbon);opacity:.42}
.rb-cost .rb-span{background:var(--cost)}
.rb-neutral .rb-span{background:var(--muted)}
.rb-tick{position:absolute;top:-2px;width:2px;height:13px;border-radius:1px;background:var(--carbon)}
.rb-cost .rb-tick{background:var(--cost)}
.rb-neutral .rb-tick{background:var(--ink)}

.stack-row{display:grid;grid-template-columns:132px 1fr;gap:14px;align-items:center;margin:10px 0}
.stack-label{font-family:var(--mono);font-size:11px;color:var(--muted);text-align:right}
.stack{display:flex;height:26px;gap:2px}
.seg{display:flex;align-items:center;justify-content:center;border-radius:3px;min-width:3px}
.seg-label{font-family:var(--mono);font-size:10px;color:#fff;mix-blend-mode:normal}
.seg-t1{background:var(--t1)} .seg-t2{background:var(--t2)} .seg-t3{background:var(--t3)} .seg-t4{background:var(--t4)}
.seg-t1 .seg-label{color:var(--ink)}
:root[data-theme="dark"] .seg-t1 .seg-label,:root[data-theme="dark"] .seg-t2 .seg-label{color:var(--ink)}

.legend{display:flex;flex-wrap:wrap;gap:8px 20px;margin:16px 0 4px;font-family:var(--sans);font-size:12.5px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.swatch{width:11px;height:11px;border-radius:3px;display:inline-block}

.tw{overflow-x:auto;border:1px solid var(--rule);background:var(--raised);margin:14px 0 4px}
table{width:100%;border-collapse:collapse;font-family:var(--sans);font-size:13px}
thead th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  font-weight:500;color:var(--muted);background:var(--sunk);padding:9px 12px;border-bottom:1px solid var(--rule);white-space:nowrap}
tbody td{padding:9px 12px;border-bottom:1px solid var(--rule-soft);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
th.n,td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.lbl{color:var(--ink);font-weight:600}
td.money{color:var(--cost)}
td.bar,th.bar{width:34%;min-width:120px}
.tier{font-family:var(--mono);font-size:10.5px;padding:2px 6px;border-radius:3px;color:#fff}
.tier-1{background:var(--t1);color:var(--ink)} .tier-2{background:var(--t2)} .tier-3{background:var(--t3)} .tier-4{background:var(--t4)}

.limits{background:var(--warn-bg);border-left:3px solid var(--warn-edge);padding:18px 22px;margin:14px 0}
.limits ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px}
.limits li{font-size:15px}
.limits li::marker{color:var(--warn-edge)}

code{font-family:var(--mono);font-size:.87em;background:var(--sunk);padding:1px 5px;border-radius:3px;color:var(--ink)}
footer{margin-top:64px;padding-top:20px;border-top:2px solid var(--ink);font-family:var(--mono);font-size:11px;color:var(--muted)}
`;

/**
 * Render the pack as a standalone HTML document.
 *
 * Self-contained by necessity: no webfonts, scripts, images or external CSS, so
 * it survives a strict CSP, an email attachment and an auditor's air-gapped
 * laptop equally well.
 */
export function renderEvidencePackHtml(pack: EvidencePack): string {
  const t = pack.tierDistribution;
  // Legend must cover every tier that appears in ANY row, not just the composite —
  // the composite is often uniformly Tier 1 while energy reaches Tier 2.
  const activeTiers = ([1, 2, 3, 4] as Tier[]).filter(
    (x) =>
      t.counts[x] > 0 ||
      pack.tierByResource.energy.counts[x] > 0 ||
      pack.tierByResource.carbon.counts[x] > 0 ||
      pack.tierByResource.cost.counts[x] > 0,
  );

  const legend = activeTiers
    .map(
      (x) =>
        `<span><i class="swatch" style="background:var(--t${x})"></i>Tier ${x} — ${esc(TIERS[x].label)}</span>`,
    )
    .join("");

  const tierRows = activeTiers
    .map(
      (x) =>
        `<tr><td class="lbl">Tier ${x}</td><td>${esc(TIERS[x].label)}</td>` +
        `<td class="n">${t.counts[x]}</td><td class="n">${pct(t.shares[x])}</td>` +
        `<td class="n">${pct(t.carbonShares[x])}</td></tr>`,
    )
    .join("");

  const factorRows = pack.factorRegister
    .map(
      (f) =>
        `<tr><td class="lbl"><code>${esc(f.id)}</code></td><td>${esc(f.kind)}</td>` +
        `<td><code>${esc(f.version)}</code></td><td>${esc(f.source)}</td><td class="n">${esc(f.retrieved.slice(0, 10))}</td></tr>`,
    )
    .join("");

  const restatementRows = pack.restatements
    .map(
      (r) =>
        `<tr><td class="lbl"><code>${esc(r.factorId)}</code></td>` +
        `<td class="n"><code>${esc(r.fromVersion)}</code> → <code>${esc(r.toVersion)}</code></td>` +
        `<td class="n">${r.materialityEstimate === undefined ? "—" : pct(r.materialityEstimate)}</td>` +
        `<td>${esc(r.reason)}</td></tr>`,
    )
    .join("");

  const breakdowns = Object.entries(pack.breakdowns)
    .map(([dim, groups]) => breakdownSection(dim as Dimension, groups))
    .join("");

  return `<title>Evidence pack — ${esc(pack.meta.entity)}</title>
<style>${CSS}</style>
<div class="doc">
  <header class="head">
    <div class="eyebrow">GHG Protocol · Scope 3 Category 1 · purchased goods and services</div>
    <h1>AI inference emissions — evidence pack</h1>
    <div class="facts">
      <div>Entity<b>${esc(pack.meta.entity)}</b></div>
      <div>Period<b>${esc(pack.meta.periodStart)} → ${esc(pack.meta.periodEnd)}</b></div>
      <div>Factor set<b>${esc(pack.meta.factorSetVersion)}</b></div>
      <div>Grid signal<b>${esc(pack.meta.gridSignal)}${pack.meta.marginalEstimated ? " (inferred)" : ""}</b></div>
    </div>
    <div class="pull">This pack is designed to be <strong>checked, not believed</strong>. Every figure
      is drawn as the range it actually is — the bar shows low to high, the tick shows the central
      estimate. Section 5 lists the limitations of this report, generated from its own data rather
      than authored.</div>
  </header>

  <h2><span class="num">01</span> Totals</h2>
  <div class="cards">
    ${totalCard("Carbon", pack.totals.carbon, "carbon", true)}
    ${totalCard("Energy", pack.totals.energy, "neutral")}
    ${totalCard("Water", pack.totals.water, "neutral")}
    ${totalCard("Land", pack.totals.land, "neutral")}
    ${totalCard("Cost", pack.totals.cost, "cost")}
  </div>
  <p class="fine">Scope: ${pack.scope.traces.toLocaleString()} traces ·
    ${pack.scope.calls.toLocaleString()} model calls ·
    ${pack.scope.tokens.toLocaleString()} tokens, of which
    ${pack.scope.invisibleTokens.toLocaleString()} were billed but never surfaced to a user ·
    ${pack.scope.outcomes.toLocaleString()} functional units${
      pack.totals.sci
        ? ` · SCI ${esc(formatQuantity(pack.totals.sci))} per ${esc(pack.meta.functionalUnit ?? "unit")}`
        : ""
    }.</p>

  <h2><span class="num">02</span> Evidence tiers</h2>
  <p>Tier is evidence strength, not quality of outcome — Tier 1 is less precise, not worse. The
    reported tier is the weakest link across all four resources, so the per-resource rows below
    matter more than the headline: <strong>the gap between the energy row and the carbon row is the
    input holding this report back.</strong></p>
  <div class="legend">${legend}</div>
  ${stackedTierBar(pack.tierByResource.energy.shares, "energy")}
  ${stackedTierBar(pack.tierByResource.carbon.shares, "carbon")}
  ${stackedTierBar(pack.tierByResource.land.shares, "land")}
  ${stackedTierBar(pack.tierByResource.cost.shares, "cost")}
  ${stackedTierBar(t.shares, "composite")}
  <p class="fine">Shares by trace. Composite is the weakest link and is therefore never better than
    the worst row above it.</p>
  <div class="tw"><table>
    <thead><tr><th>Tier</th><th>Basis</th><th class="n">Traces</th><th class="n">Share</th><th class="n">Share of carbon</th></tr></thead>
    <tbody>${tierRows}</tbody>
  </table></div>

  <h2><span class="num">03</span> Breakdowns</h2>
  ${breakdowns}

  <h2><span class="num">04</span> Methodology and boundaries</h2>
  <p>${esc(pack.methodology)}</p>
  <p><strong>Included.</strong> Energy consumed serving inference: accelerator draw, host CPU/RAM and
    networking, amortised idle and reserve capacity, and facility overhead (PUE). Carbon from that
    energy at the stated grid intensity, plus an amortised share of hardware manufacturing. Water
    on-site and off-site. Cost as billed where known, else public list price.</p>
  <p><strong>Excluded.</strong> Model training. End-user device energy. Network transit beyond the
    datacentre. Employee and office emissions. These belong elsewhere in a corporate inventory.</p>

  <h2><span class="num">05</span> Limitations</h2>
  <p class="fine">Generated from this report's own data, not authored.</p>
  <div class="limits"><ul>${pack.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>

  <h2><span class="num">06</span> Factor register</h2>
  <p>Every coefficient used, with the version and the date it was retrieved.</p>
  <div class="tw"><table>
    <thead><tr><th>Factor</th><th>Kind</th><th>Version</th><th>Source</th><th class="n">Retrieved</th></tr></thead>
    <tbody>${factorRows}</tbody>
  </table></div>

  ${
    pack.restatements.length > 0
      ? `<h2><span class="num">07</span> Restatements</h2>
  <p>Factor changes shipped in this set. Figures are not comparable with reports generated against
    earlier versions unless those are restated.</p>
  <div class="tw"><table>
    <thead><tr><th>Factor</th><th class="n">Version</th><th class="n">Materiality</th><th>Reason</th></tr></thead>
    <tbody>${restatementRows}</tbody>
  </table></div>`
      : ""
  }

  <footer>Generated against factor set ${esc(pack.meta.factorSetVersion)} · every figure reproducible from that version.</footer>
</div>`;
}

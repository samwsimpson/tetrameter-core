/**
 * Datacentre overhead, water intensity, and embodied hardware emissions.
 *
 * These three are grouped because they share a failure mode: they are the parts
 * most tools quietly omit, and omitting them makes your numbers look better than
 * they are. ML CO2 Impact does not account for PUE at all. CodeCarbon's software
 * tracking underestimates by roughly 20% because it cannot see power supply
 * losses, cooling, or peripherals.
 */

import type { FactorRef } from "../provenance.js";

const VERSION = "2026.08.0";
const RETRIEVED = "2026-07-31";

export interface OverheadFactor {
  readonly value: number;
  readonly low: number;
  readonly high: number;
  readonly ref: FactorRef;
}

/**
 * Non-accelerator host power and idle/reserve capacity, as a multiplier on
 * measured GPU energy.
 *
 * ── Why this factor has to exist ─────────────────────────────────────────────
 *
 * ML.ENERGY measures the accelerator at the device. Google's published figure
 * measures everything: GPU, host CPU and RAM, networking, and — importantly —
 * idle and reserve capacity amortised across served requests. A production fleet
 * holds headroom for peak load, and somebody has to account for its power.
 *
 * Between those two boundaries sits a real, large gap. Ignoring it is how a
 * bottom-up estimate ends up several times below the only first-party number in
 * existence.
 *
 * ── Derivation (check this arithmetic — that is the point) ───────────────────
 *
 *   ML.ENERGY mid-class median          0.1559 Wh / 1k output tokens (GPU only)
 *   ML.ENERGY chat median output length    634 tokens
 *   ⇒ GPU energy per request            0.0989 Wh
 *
 *   Google published median Gemini prompt  0.2400 Wh (full stack)
 *   ⇒ total overhead ratio                 2.43×
 *   ÷ Google fleet PUE                     1.09
 *   ⇒ non-PUE host + idle overhead         2.23×
 *
 * The band spans 1.4× (a dedicated, well-utilised fleet with little idle) to
 * 4.0× (heavy reserve capacity, low utilisation). It is wide because utilisation
 * is the dominant term and no API customer can observe it.
 *
 * A test asserts that a Gemini-shaped request computed through this chain lands
 * near Google's published 0.24 Wh. If that test ever fails, either the factor or
 * the upstream data moved, and it is a restatement event.
 */
export const HOST_OVERHEAD: OverheadFactor = {
  value: 2.23,
  low: 1.4,
  high: 4.0,
  ref: {
    id: "overhead.host",
    kind: "overhead",
    version: VERSION,
    source:
      "Derived: Google published median Gemini prompt (0.24 Wh full stack, Aug 2025) reconciled " +
      "against ML.ENERGY mid-class accelerator-only median, net of Google fleet PUE ~1.09",
    url: "https://arxiv.org/pdf/2508.15734",
    retrieved: RETRIEVED,
    note:
      "Covers host CPU/RAM/NIC plus amortised idle and reserve capacity — everything between " +
      "the accelerator and the facility meter. Utilisation dominates the band and is not " +
      "observable by an API customer.",
  },
};

/**
 * Power Usage Effectiveness — total facility power over IT power.
 *
 * Google reports ~1.09 fleet-wide, which is close to best-in-class. Industry
 * average sits nearer 1.2–1.5. We default to 1.15 with a band spanning both,
 * because you generally do not know which datacentre served your API call.
 */
export const PUE: OverheadFactor = {
  value: 1.15,
  low: 1.08,
  high: 1.4,
  ref: {
    id: "overhead.pue",
    kind: "overhead",
    version: VERSION,
    source: "Google datacentre PUE disclosures (~1.09) and industry averages (1.2–1.5)",
    url: "https://arxiv.org/pdf/2508.15734",
    retrieved: RETRIEVED,
    note:
      "Band deliberately spans hyperscaler best-case to industry average, because the " +
      "serving facility for a third-party API call is not knowable by the customer.",
  },
};

/**
 * Water intensity, split into the two components that get conflated.
 *
 *   ON-SITE  — evaporative cooling at the datacentre (WUE).
 *   OFF-SITE — water consumed generating the electricity in the first place.
 *
 * The conflation matters enormously. Google's published figure is 0.26 mL per
 * median Gemini prompt against 0.24 Wh, implying roughly 1.1 L/kWh on a largely
 * on-site boundary. Mistral's audited LCA puts a ~400-token reply at 45 mL —
 * over 170× higher — because it uses a full lifecycle boundary including
 * electricity generation and hardware.
 *
 * Neither is wrong. They answer different questions. We model them separately and
 * report the boundary, which is the only honest way to handle a 170× disagreement
 * between the only two first-party sources that exist.
 */
export const WATER_ONSITE: OverheadFactor = {
  value: 0.35,
  low: 0.1,
  high: 0.8,
  ref: {
    id: "water.onsite",
    kind: "water-intensity",
    version: VERSION,
    source: "Hyperscaler WUE disclosures (L per kWh of IT load), Google 2025 environmental report",
    url: "https://cloud.google.com/blog/products/infrastructure/measuring-the-environmental-impact-of-ai-inference",
    retrieved: RETRIEVED,
    note: "On-site evaporative cooling only. Excludes water used to generate the electricity.",
  },
};

export const WATER_OFFSITE: OverheadFactor = {
  value: 1.8,
  low: 0.9,
  high: 3.5,
  ref: {
    id: "water.offsite",
    kind: "water-intensity",
    version: VERSION,
    source: "Thermoelectric water consumption factors for grid generation",
    url: "https://arxiv.org/abs/2505.09598",
    retrieved: RETRIEVED,
    note:
      "Water consumed generating the electricity. Varies enormously by generation mix — " +
      "hydro and thermal are water-intensive, wind and solar are not. Zone-specific " +
      "factors are a P1 improvement.",
  },
};

/**
 * Embodied emissions: manufacturing the hardware, amortised across its useful output.
 *
 * Expressed as a fraction of operational emissions rather than an absolute, because
 * absolute embodied figures require knowing the accelerator model, its lifetime and
 * its utilisation — none of which a third-party API customer can see. EcoLogits
 * includes an embodied share; most tools omit it entirely, which understates.
 *
 * A 15% uplift is a conservative central estimate for high-utilisation inference
 * hardware. The band is wide because utilisation assumptions dominate the result.
 */
export const EMBODIED_RATIO: OverheadFactor = {
  value: 0.15,
  low: 0.05,
  high: 0.35,
  ref: {
    id: "embodied.ratio",
    kind: "embodied",
    version: VERSION,
    source: "Amortised accelerator manufacturing emissions as a share of operational, after EcoLogits",
    url: "https://ecologits.ai/",
    retrieved: RETRIEVED,
    note:
      "Expressed as a ratio because absolute embodied emissions require accelerator model, " +
      "lifetime and utilisation — none visible to an API customer. Omitting embodied " +
      "entirely, as most tools do, understates the footprint.",
  },
};

export const ALL_OVERHEAD_REFS: readonly FactorRef[] = [
  HOST_OVERHEAD.ref,
  PUE.ref,
  WATER_ONSITE.ref,
  WATER_OFFSITE.ref,
  EMBODIED_RATIO.ref,
];

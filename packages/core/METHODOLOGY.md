# Methodology — v0.2 (factor set `2026.08.0`)

**Status: model energy is now measured; grid factors are not. Not yet suitable for a filed
disclosure.** See "Known gaps" at the end.

This document exists so that any number this library produces can be reproduced and argued with by
someone who does not work here. That is the whole point: our moat is not the arithmetic, it is that
the arithmetic is checkable.

---

## 1. What we compute, and why energy is the pivot

```
tokens ──▶ accelerator energy ──▶ × host overhead ──▶ × PUE ──▶ facility energy
             (ML.ENERGY, measured)   (CPU/RAM/NIC,                    │
                                      idle + reserve)                 │
                                ┌───────────────┬────────────────┐
                                ▼               ▼                ▼
                          × grid intensity  × water     (+ embodied uplift)
                                │            intensity
                                ▼               ▼
                             carbon           water
```

The three boundaries are kept separate on purpose. ML.ENERGY measures the accelerator at the device;
Google's published figure measures the whole facility. Collapsing them into one coefficient is how a
bottom-up estimate silently ends up several times below the only first-party number in existence.

Energy is upstream of everything. Carbon, water and (via model choice) cost all derive from it. This
is also why the product is named after measurement rather than after carbon — carbon is one output,
not the model.

## 2. The four-tier evidence framework

After Cook et al., *Accounting for AI Inference in Corporate GHG Inventories: A Four-Tier Methodology
for Scope 3 Category 1 Reporting* ([arXiv:2606.10660](https://arxiv.org/pdf/2606.10660)).

| Tier | Label | Requires | Typical band |
|---|---|---|---|
| 1 | Class average | Call counts or spend, by rough model class | ±200% |
| 2 | Model and region specific | Per-call model, tokens, serving region | ±80% |
| 3 | Measured power | Host/GPU telemetry, or provider-disclosed per-request energy | ±25% |
| 4 | Measured power, dynamic grid | Real-time telemetry plus time-resolved grid | ±10% |

**Tier 2 is the honest ceiling for third-party API usage.** The paper names provider transparency as
the binding constraint, and it is right: no amount of engineering on our side can produce Tier 3
evidence when the provider publishes nothing per request. `MAX_TIER_WITHOUT_PROVIDER_DISCLOSURE`
enforces this in code so we cannot accidentally claim otherwise.

**The tier is the weakest link in the chain.** A precisely measured kWh multiplied by a Tier 1 annual
grid average does not yield a Tier 3 carbon figure. `computeCall` reports the minimum across the four
resources, and there is a test asserting exactly this.

## 3. Uncertainty is disclosed, not hidden

ISAE 3410 acknowledges inherent scientific and estimation uncertainty in GHG quantification, requires
that it be **disclosed**, and states this does not preclude GHG emissions from being an appropriate
subject matter for assurance — unless the uncertainty is material to the statement.

That is the unlock. We do not need to be right. We need to be documented, versioned, traceable and
honest about ranges. So:

- Every value is a `Quantity` carrying `low`, `high`, `tier` and `sources`. There is no code path
  that produces a bare number.
- `formatQuantity()` renders a **range** rather than a point value whenever the band exceeds half the
  central value. The UI contract is that this is the function you call.
- Bands propagate multiplicatively and sum conservatively. They widen, never narrow, through a chain.

## 4. Average vs marginal grid intensity

The most consequential methodological choice in the library.

| | Signal | Answers | Used for |
|---|---|---|---|
| **Average** (location-based) | Weighted mean of all generation serving the grid | "What share of grid emissions is attributable to my consumption?" | **Inventory reporting.** What GHG Protocol requires. |
| **Marginal** (MOER) | Emissions of the generators that respond to a change in load | "What changes if I stop doing this?" | **Reduction claims.** What is physically true. |

Published work on carbon-aware scheduling found the same intervention reading **18% savings on the
average signal and 11% on marginal** — and, critically, that *"carbon savings only manifest when the
same signal is used to compute savings; based on the other signal, carbon savings are negative"*
([ACM e-Energy, 10.1145/3632775.3661953](https://dl.acm.org/doi/fullHtml/10.1145/3632775.3661953)).

Most savings claims in this market are artifacts of the vendor's chosen signal. `resolveGrid` throws
`MarginalSignalUnavailableError` rather than falling back to the average, because silently
substituting is exactly how claims get overstated.

Marginal is usually **higher** than average where low-carbon baseload dominates. France's average is
~41 gCO₂e/kWh thanks to nuclear, but the unit that follows load is typically gas, so the inferred
marginal is ~591 — a **14× ratio**. In coal-heavy Poland the two converge (589 → 840, 1.4×) because
coal sets both. If that pattern ever inverted, the inference would be broken.

### Our marginal figures are inferred, and gated behind an opt-in

A true MOER is measured by regressing grid emissions against load — that is what WattTime sells and
what we have not bought. Ours are inferred from fossil generation mix, on the reasoning that the
units following load are the dispatchable fossil ones:

```
marginal = Σ (share of source within fossil generation × source intensity)
           coal 950 [820–1100] · gas 490 [370–610] · oil 700 [600–850] gCO₂e/kWh
```

Gas skews above baseload CCGT because peaking plant is often less efficient OCGT, and peakers are
disproportionately on the margin.

Three guards keep this honest:

- **Below 5% fossil generation, we return nothing.** The marginal unit there is more likely hydro,
  imports or curtailed renewables. Norway and Sweden sit here — inferring a marginal ~20× their
  average off a 1% fossil sliver would look authoritative and mean nothing.
- **Between 5% and 20%, the band widens a further ±35%**, because the inference is weaker.
- **`resolveGrid` refuses to serve an inferred marginal to a reduction claim** unless the caller
  passes `allowEstimatedMarginal: true`. Deliberate friction. The failure mode here is not being
  wrong — it is being wrong in the direction that flatters the customer, quietly, in a document that
  goes to a regulator.

When WattTime is wired, these become measured and the opt-in becomes unnecessary.

## 5. Sources behind the coefficients

| Source | What it gives | Status |
|---|---|---|
| [Google, Aug 2025](https://arxiv.org/pdf/2508.15734) | Median Gemini prompt: 0.24 Wh, 0.03 gCO₂e, 0.26 mL water, from May 2025 production data. Includes cooling, idle reserve, CPU/RAM, DC overhead. | First-party. The best figure of its kind. |
| Mistral × Carbone 4 × ADEME, Jul 2025 | ~400-token reply ≈ 1.14 gCO₂e, 45 mL water. | Third-party audited. Only other first-party LCA. |
| [Jegham et al. 2025](https://arxiv.org/abs/2505.09598) | 30 commercial models, 0.42 Wh (short) to 29–33 Wh (long prompt). A **65× spread from model choice alone**. | Peer-reviewed. |
| [ML.ENERGY Benchmark](https://arxiv.org/html/2505.06371v1) | Per-model inference energy under realistic serving. | **Ingested** — snapshot 2026-02-16, 328 serving configurations, 24 open-weight models, H100 and B200. |
| [HF AI Energy Score](https://huggingface.co/spaces/AIEnergyScore/Leaderboard) | 166 models, H100-normalised, 1–5 stars. | Not yet ingested. |
| [LiteLLM price catalogue](https://github.com/BerriAI/litellm) | Token pricing, ~2,100 chat models incl. Bedrock/Azure/Vertex/aggregator rates. | **Ingested** (MIT). |
| EMBER / Electricity Maps | Grid carbon intensity. | Static annual averages only; live API pending. |
| WattTime | Marginal emissions (MOER). | Static estimates only; live API pending. |

**Cost is the one resource that can be exactly known**, because the provider bills it. `billedCostUsd`
on a call always wins and is Tier 4. The catalogue is only for estimating when it is absent: a
catalogue hit is Tier 2 and bands *downward only* (list price is the ceiling; the unknown is the
customer's negotiated discount), while a class-median fallback is Tier 1 with a wide two-sided band.

## 6. Specific modelling decisions

**Serving configuration is the dominant uncertainty, and we do not average it away.** The same model
measures 4–35× apart per token depending on batch size, GPU generation, parallelism and weight
precision. Qwen3-14B is 0.699 J/token at batch 8 and 0.167 J/token at batch 64. A customer buying
inference through an API cannot see or control any of that, so the p10–p90 spread across measured
configurations *is* the uncertainty band. Quoting a single figure would be false precision.

**Reasoning models are expensive on two axes, and we had it wrong at first.** The bootstrap applied a
4.5× per-token penalty to reasoning models. Measurement shows the per-token premium for a given model
is nearer 2–3× and comes from long-context attention, not from being a reasoning model. The real cost
driver is token count: median output length is 5,400–11,445 tokens on GPQA against 634 on chat. Since
token count was already modelled separately, the bootstrap was double-counting. Together the two axes
compound to roughly 45× per request, consistent with the 65× spread Jegham et al. observed.

**Prefill vs decode.** Output tokens cost more than input tokens, because prefill is compute-bound and
parallelisable while decode is memory-bandwidth-bound and strictly sequential. But the ML.ENERGY
figure is *request energy divided by output tokens*, so a typical prompt's prefill is already
amortised in. `prefillRatio` is therefore only 0.05, covering input beyond a typical prompt — a larger
value would double-count.

**Reasoning tokens count as output.** They are sequentially decoded and billed as output. They are
tracked separately only so we can show how much of a footprint went into thinking the user never
sees ([arXiv:2505.18471](https://arxiv.org/pdf/2505.18471), "Invisible Tokens, Visible Bills").

**Host overhead of 2.23×, derived rather than guessed.** ML.ENERGY measures the accelerator; Google
measures the facility. Between them sit host CPU/RAM/NIC and amortised idle and reserve capacity.
The derivation, which you can check in two lines:

```
ML.ENERGY mid-class median          0.1559 Wh / 1k output tokens (GPU only)
ML.ENERGY chat median output length    634 tokens
⇒ GPU energy per request            0.0989 Wh

Google published median prompt      0.2400 Wh (full stack)
⇒ total overhead ratio                2.43×
÷ Google fleet PUE                    1.09
⇒ non-PUE host + idle overhead        2.23×
```

Band 1.4×–4.0×, wide because utilisation dominates and is not observable by an API customer.

**PUE defaults to 1.15, band 1.08–1.40.** Google reports ~1.09 fleet-wide; industry average is nearer
1.2–1.5. The band spans both, because the serving facility for a third-party API call is not knowable
by the customer. ML CO2 Impact omits PUE entirely, which understates.

**Model-class routing is anchored to separators.** An unanchored substring match is a silent,
systematic mis-estimate. One got through review: `gemini-3-pro` contains "mini", so it classified as a
small model and every Gemini call was understated roughly fourfold. Nothing failed — the numbers were
just quietly wrong. It was caught by the reconciliation test in §6a, not by reading the regex.

## 6a. External validation

The engine reproduces the only first-party disclosure in existence. A 634-token Gemini-class request
computed through the full chain lands near Google's published 0.24 Wh, and their figure sits inside
our reported band. There is a test asserting both.

This is the single external check available on the whole bottom-up model. If it ever drifts, either an
upstream factor moved or we introduced an error — and either way it is a restatement event, not
something to quietly retune until the test passes again.

**Water is split on-site and off-site.** Google's figure implies roughly 1.1 L/kWh on a largely
on-site boundary; Mistral's audited LCA is **over 170× higher** because it uses a full lifecycle
boundary. Neither is wrong — they answer different questions. Blending them into one number would
hide a disagreement that a reader deserves to see.

**Embodied emissions are a ratio, not an absolute.** 15% uplift on operational, band 5–35%. Absolute
embodied figures require accelerator model, lifetime and utilisation, none of which an API customer
can see. Most tools omit embodied entirely, which understates.

## 7. Waste findings claim disjoint token buckets

Each detector prices only the tokens it can actually recover — the resent context, the wasted
reasoning budget, the duplicate request — not a percentage of whole calls. Two findings can implicate
the same call, so fractional claims would double-count and inflate the headline figure. Disjoint
buckets make "recoverable cannot exceed the trace" a property of the design. There is a test.

Findings are **hypotheses with estimated savings, never assertions**. We read metadata, never
content, so we detect structural waste, not semantic waste. Nothing is applied automatically: the
shadow-eval quality gate (P2) is what turns a hypothesis into a safe change.

## 8. Restatements

Bumping `FACTOR_SET_VERSION` is a restatement event and must be recorded in the `RestatementLog` with
a reason and a materiality estimate. When EcoLogits switched its energy benchmark to ML.ENERGY in
2026, every historical number moved — in a disclosed inventory that requires documentation. No other
tool in this market handles it, which is why it is in the core library rather than bolted on later.

A report cites one string — `factor set 2026.07.0` — and that is sufficient for someone else to
reproduce the number exactly.

---

## Known gaps — read before using any figure externally

1. **Every benchmarked model is open-weight.** No commercial API model — Claude, GPT, Gemini — appears
   in ML.ENERGY, because no provider publishes architecture, parameter count or serving configuration.
   Calls to those models resolve to a class average and **stay Tier 1**. This is the binding
   constraint the four-tier paper identifies, and no amount of work on our side removes it. Customers
   running open-weight models self-hosted get genuine Tier 2; customers on commercial APIs do not.
2. **Grid factors are annual country averages, not time-resolved.** A call at 03:00 and one at 18:00
   get the same factor, though intraday intensity routinely varies two- to threefold. This is now
   the largest remaining source of error. Adapters for Electricity Maps (time-resolved average) and
   WattTime (measured marginal) are written and fixture-tested; the licences are deliberately
   unpurchased pre-revenue, so wiring them is a config change rather than a refactor.
3. **Sub-national zones resolve to country level.** `US-CAISO` returns US data, because we hold
   country averages only — and CAISO is materially cleaner than the US average. The downgrade is
   recorded on the factor reference so it travels into the export pack rather than being discovered
   later. Sub-national resolution needs the live adapter.
4. **Marginal figures are inferred, not measured**, and gated behind an explicit opt-in. See §4.
3. **The ML.ENERGY snapshot is dated 2026-02-16 and pinned to a commit.** It will go stale. Refresh is
   a restatement event, not a silent update.
4. **Benchmark hardware is H100 and B200 only.** Older fleets (A100 and earlier) are less efficient
   and are not represented, so figures may understate for providers running older silicon.
5. **Prices go stale fast and the snapshot is dated 2026-07-31.** Providers reprice frequently.
   Refresh is a restatement event, because it moves every historical cost figure and every savings
   claim derived from one.
6. **Water off-site factors are not zone-specific.** Generation mix drives water intensity heavily.
7. **No independent review yet.** Copying the Mistral × Carbone 4 × ADEME play — getting the
   methodology externally reviewed before launch — is the highest-leverage credibility step available
   and is scheduled for P2. It should start in P0.

## Restatement history

| Factor | From → To | Materiality | Why |
|---|---|---|---|
| `model.class.*` | 2026.07.0 → 2026.08.0 | −60% | Bootstrap class averages replaced with measured ML.ENERGY data across 328 serving configurations. Bands now derived from observed spread rather than chosen. |
| `model.class.reasoning` | 2026.07.0 → 2026.08.0 | −45% | Corrected a double-count. The 4.5× per-token reasoning premium was wrong; the real driver is token count, already modelled separately. |
| `overhead.host` | 2026.07.0 → 2026.08.0 | +123% | New factor. Makes the accelerator-to-facility boundary explicit instead of smuggling it into the model coefficient. |
| `grid.*` | 2026.07.0 → 2026.08.0 | +5% | 8 hand-written zones → ~211 country zones from Ember via OWID. The previous marginal figures were invented outright; they are now inferred from real fossil mix, flagged as estimates, and gated behind an opt-in. Zones under 5% fossil now return nothing. |
| `pricing.*` | 2026.07.0 → 2026.08.0 | −65% | Four hand-written stubs replaced with the LiteLLM catalogue. The stubs priced the large class at $15/$75 per 1M against Opus 5's actual $5/$25 — a threefold overstatement that inflated every derived savings figure. |
| `model.prefillRatio` | 2026.07.0 → 2026.08.0 | −8% | Reduced 0.12–0.15 → 0.05. Baseline prefill is already amortised into the source figure. |
| `grid.*` (resolution) | 2026.08.2 → 2026.08.3 | −19% to −68% for cloud-hosted callers | Region resolution was exact-match and case-sensitive, so every cloud provider region code fell through to the global average of 475 gCO₂e/kWh. `us-central1` read 475 against a US average of 384 (−19% on restatement); `europe-west1` read 475 against a Belgian grid of 150 (−68%). ~140 GCP, AWS and Azure region codes now map to the country they sit in, and lookup is case-insensitive. **No coefficient changed** — this is a defect in how inputs were matched to existing coefficients. |

Machine-readable in `RESTATEMENTS` (see `factors/index.ts`), so a report can cite it mechanically
rather than someone remembering to update a wiki.

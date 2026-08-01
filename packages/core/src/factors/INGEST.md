# Regenerating the ingested factor files

`mlenergy.ts` and `pricing-data.ts` are generated, not hand-edited. Editing them directly breaks the
guarantee that every number traces back to a published snapshot.

---

# 1. `mlenergy.ts` — model energy

## Source

The ML.ENERGY leaderboard publishes its measurements as JSON in the repo that builds the site:

```
https://github.com/ml-energy/leaderboard  →  public/data/
  index.json              model metadata, last_updated
  tasks/lm-arena-chat.json   chat regime measurements
  tasks/gpqa.json            long-context reasoning regime measurements
```

**Pin the commit SHA, don't use `main`.** A moving snapshot means yesterday's report cannot be
reproduced. Current pin: `5d899ea5a1c8934c0eff691df2b731d20490bb2a`, snapshot dated `2026-02-16`.

## Fields we use

| Source field | Use |
|---|---|
| `energy_per_token_joules` | The measurement. Total request energy ÷ output tokens, so baseline prefill is amortised in — see `models.ts` on why `prefillRatio` is small. |
| `model_id` | Key, lowercased. |
| `activated_params_billions` | Class assignment. MoE models go by *activated*, not total. |
| `avg_output_len` | Needed for the Google reconciliation in `overhead.ts`. |
| `gpu_model`, `weight_precision`, `architecture` | Provenance in the factor ref. |

Ignored: throughput, latency percentiles, batch size. They drive the spread we capture as the band,
but we don't model them individually because a customer can't observe them anyway.

## Derivation

For each `(model_id, regime)`, take **p10 / median / p90 of `energy_per_token_joules`** across all
serving configurations, then convert J/token → Wh per 1,000 tokens (`× 1000 / 3600`).

The percentile spread is the point. Do not collapse it to a mean.

Class aggregates: `small` ≤9B activated, `mid` ≤32B, `large` >32B — all from the chat task. The
`reasoning` class comes from GPQA **restricted to ≥20B activated**, because the unrestricted median is
dragged to 0.104 Wh/1k by small efficient models like gpt-oss-20b and would badly understate a
frontier reasoning model.

## After regenerating

1. Run `pnpm test`. The Google reconciliation test in `test/factors.test.ts` is the tripwire — if the
   upstream data shifted materially, it fails.
2. Bump `FACTOR_SET_VERSION`.
3. **Add a `RESTATEMENTS` entry** with a reason and a materiality estimate. A refresh moves every
   historical figure; in a disclosed inventory that is a restatement event, not a silent update.
4. Update the restatement table at the bottom of `METHODOLOGY.md`.

---

# 2. `pricing-data.ts` — token pricing

## Source

```
https://github.com/BerriAI/litellm  →  model_prices_and_context_window.json
```

MIT licensed. ~2,986 entries, of which ~2,157 are chat-mode with both input and output costs.
Includes Bedrock, Azure, Vertex and aggregator pricing, which genuinely differs from direct-API
pricing for the same underlying model — that distinction is worth preserving, not collapsing.

## Fields we use

| Source field | Use |
|---|---|
| `input_cost_per_token`, `output_cost_per_token` | The prices. Multiply by 1e6 for per-1M. |
| `cache_read_input_token_cost` | Cached input rate. Absent means no published discount, **not** free. |
| `supports_reasoning` | Carried through as a flag. Not used to drive the energy class — a model that *can* reason is not always reasoning, and the actual signal is reasoning tokens on the call. |
| `mode` | Filter to `chat` / `responses`. |

## Filtering

Keep entries where `mode` is chat or responses **and** both costs are present **and** at least one is
non-zero. Store as tuples rather than objects purely for bundle size (~119 KB).

Class medians are computed over the filtered set using the same `classifyModel` patterns the library
uses, so the fallback is a median of real prices rather than a guess.

## After regenerating

1. Run `pnpm test` — `test/pricing.test.ts` asserts known prices (Sonnet 5 at $2/$10) and sanity
   invariants (no negatives, output generally dearer than input).
2. Bump `FACTOR_SET_VERSION` and add a `RESTATEMENTS` entry. Prices move constantly; a refresh
   changes every historical cost figure and every savings claim derived from it.

## A note on why exact prices matter here

Cost is the entry motion. The bootstrap stubs priced the large class at $15/$75 per 1M against Claude
Opus 5's actual $5/$25 — a threefold overstatement that would have inflated every savings figure in a
first customer meeting. A carbon number with a careful band sitting next to a dollar number pulled
from thin air is a product that loses the room.

---

# 3. `grid-data.ts` — grid carbon intensity

## Sources

| What | Where |
|---|---|
| Average intensity | [OWID: Carbon intensity of electricity](https://ourworldindata.org/grapher/carbon-intensity-electricity) (Ember, CC BY) |
| Generation mix | [OWID: Electricity production by source](https://ourworldindata.org/grapher/electricity-prod-source-stacked) |

Both as `?csvType=full&useColumnShortNames=true`. Take the **latest year per ISO3 country code**.

## Derivation

**Average** is used directly, with a ±15% band covering interannual variation and methodological
spread between inventories.

**Marginal** is inferred — see `MARGINAL_METHOD` in the generated file and §4 of METHODOLOGY.md.
Weight the fossil source intensities by their share *within fossil generation*:

```
coal 950 [820–1100] · gas 490 [370–610] · oil 700 [600–850] gCO₂e/kWh
```

Guards, all of which matter:

- `MARGINAL_MIN_FOSSIL_SHARE = 0.05` — below this, emit `null`. Do not lower it. Norway at 1% fossil
  produces a marginal ~20× its average, which is authoritative-looking nonsense.
- Fossil share under 20% widens the band a further ±35%.
- `MIN_OBSERVATION_YEAR = 2020` — drop zones whose latest observation is older. Grids decarbonise
  fast enough that a 15-year-old intensity is wrong, not merely stale. Currently cuts one zone
  (Western Sahara, 2009).

## Zone keys

ISO2 where a mapping exists (`US`, `GB`, `FR`), ISO3 otherwise. ISO2 is chosen for compatibility with
Electricity Maps zone codes, so the live adapter drops in without a translation layer.

Sub-national codes (`US-CAISO`) are **not** in the table. `resolveGrid` falls back one level to the
country and records the downgrade on the factor reference. Do not fabricate sub-national values —
that resolution genuinely requires the live adapter.

## After regenerating

1. `pnpm test` — `test/grid.test.ts` asserts the fossil floor, the recency floor, band widening, and
   that clean/dirty grids stay correctly ordered.
2. Bump `FACTOR_SET_VERSION` and add a `RESTATEMENTS` entry.

---

# Not yet ingested

**HF AI Energy Score** — 166 models, H100-normalised, 1–5 star ratings. Broader model coverage than
ML.ENERGY and a consumer-legible rating we'd want in a model-picker UI. Different measurement
boundary, so it needs its own reconciliation before mixing.

**Live grid data** — Electricity Maps (time-resolved average) and WattTime (measured marginal).
Adapters are **written and fixture-tested** in `grid-providers.ts`; the commercial licences are
deliberately unpurchased pre-revenue (~€6,000/yr and ~$9,000/yr respectively). Wiring them is a
config change. They fix the two things the static table structurally cannot: time resolution, and a
marginal signal that is measured rather than inferred.

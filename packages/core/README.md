# @kumokodo/tetrameter-core

**Four measures of AI inference: energy, carbon, water and land, with cost outside them as the same
consumption priced.** A reference implementation of the Green Software Foundation's Software Carbon
Intensity specification for AI.

Zero runtime dependencies. Every number carries an uncertainty range, an evidence tier and the
factors it came from — you cannot get a bare scalar out of this library, and that is the point.

```bash
npm install @kumokodo/tetrameter-core
```

```ts
import { computeTrace, formatQuantity } from "@kumokodo/tetrameter-core";

const footprint = computeTrace({
  traceId: "report-8f21",
  outcome: "recognition report",
  calls: [
    { model: "anthropic/claude-haiku-4-5", inputTokens: 1_240, outputTokens: 380 },
    { model: "openai/gpt-4o-mini",         inputTokens: 1_240, outputTokens: 412 },
  ],
});

formatQuantity(footprint.carbon);  //  "0.162 – 18 gCO2e"
footprint.carbon.tier;             //  1 = class average, not our confidence
footprint.carbon.sources;          //  [model.class.small, overhead.host, overhead.pue, grid.US]
```

## Why the range is wide, and why we print it

That figure spans two orders of magnitude. It is not sloppiness — it is the honest answer for a
proprietary API model whose operator publishes nothing about its energy draw.

A tool that printed a single tidy carbon number for the same call would not be more accurate. It
would be less honest. Limited assurance under ISAE 3410 does not test whether your number is right;
it tests whether your methodology is documented, your figures are traceable to their inputs, your
factors are tested, and your uncertainty is disclosed. It explicitly tolerates a range.

So this library reports one, and labels the evidence behind it.

| Tier | Basis |
|---|---|
| 1 | Class average from measured open-weight models of comparable scale. The ceiling for any proprietary API model. |
| 2 | A published measurement for this specific model under a known serving configuration. |
| 3 | Measured energy for this model on the hardware and region it actually ran on. |
| 4 | Deployment measurement combined with the grid's carbon intensity at the hour of the call. |

A composite figure is reported at the **weakest** tier of anything it depends on, because a chain is
only as good as its worst link. The tier is not our confidence in the arithmetic — it is a statement
about what evidence exists in the world, and provider disclosure is the binding constraint on most
of it.

## What it computes

- **Energy** at the accelerator, scaled by an explicit host-and-idle overhead and facility PUE.
- **Carbon** from energy and the grid factor for the region — average intensity for an inventory,
  marginal for a reduction claim, and it refuses to let a reduction claim quote an average.
- **Water** from cooling intensity.
- **Land** from the generation mix already needed for the carbon figure.
- **Cost** from the provider's billed amount where you have one, and a versioned price catalogue
  where you do not.

Plus trace-level rollups by team, feature, model or customer, and a full evidence pack with per-
number lineage.

## What is in here that you would not expect

- **Every factor carries its source, version and retrieval date.** Model energy from the ML.ENERGY
  Benchmark, grid intensity from Ember via Our World in Data, pricing from the LiteLLM catalogue.
- **A restatement log.** When a coefficient changes, every historical figure derived from it moves,
  and in a disclosed inventory that is a restatement event requiring documentation. The log lives in
  the library so a report can cite it mechanically, and it includes the August 2026 entry where we
  had overstated a model roughly threefold.
- **Tests that pin uncomfortable results.** Renewable grids use *more* land per kilowatt-hour, not
  less. That is asserted in a test so nobody can quietly "fix" the result that makes the green
  answer look worse.
- **A reconciliation test** against Google's own published median energy figure for a Gemini prompt.
  If a change breaks that agreement, the build fails.

## Boundaries we do not cross

Embodied carbon of the hardware, network transit, and the training run that produced the model are
all real, and none is reliably attributable to a single inference. Inventing an allocation would be
exactly the kind of confident fiction this library exists to argue against, so they are left out and
said so.

## Collecting the data

[`@kumokodo/tetrameter-sdk`](https://www.npmjs.com/package/@kumokodo/tetrameter-sdk) records call
metadata from the Vercel AI SDK, the Anthropic SDK or a patched `fetch`. No field in its record type
can hold a prompt or a completion.

## Licence

Apache 2.0. The licence grants no trademark rights: the code is yours to use and fork, the name is
not. See the [trademark policy](https://github.com/samwsimpson/tetrameter-core/blob/main/TRADEMARK.md).

Source, methodology and issues: **[github.com/samwsimpson/tetrameter-core](https://github.com/samwsimpson/tetrameter-core)**

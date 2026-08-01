# Tetrameter™

**Four measures of AI inference: energy, carbon, water and land, with cost outside them as the same
consumption priced.** A reference implementation of the Green Software Foundation's Software Carbon
Intensity specification for AI.

Every number this library returns carries an uncertainty range, an evidence tier and the list of
factors it came from. You cannot get a bare scalar out of it, and that is the point.

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

That figure spans two orders of magnitude. This is not sloppiness — it is the honest answer for a
proprietary API model whose operator publishes nothing about its energy draw.

A tool that printed a single tidy carbon number for the same call would not be more accurate. It
would be less honest. Limited assurance under ISAE 3410 does not test whether your number is right;
it tests whether your methodology is documented, your figures are traceable, your factors are
tested, and your uncertainty is disclosed. It explicitly tolerates a range.

So this library reports one, and labels the tier of evidence behind it.

| Tier | Basis |
|---|---|
| 1 | Class average from measured open-weight models of comparable scale. The ceiling for any proprietary API model. |
| 2 | A published measurement for this specific model under a known serving configuration. |
| 3 | Measured energy for this model on the hardware and region it actually ran on. |
| 4 | Deployment measurement combined with the grid's carbon intensity at the hour of the call. |

A composite figure is reported at the **weakest** tier of anything it depends on, because a chain is
only as good as its worst link.

## Packages

| Package | What |
|---|---|
| [`@kumokodo/tetrameter-core`](packages/core) | The engine. Coefficients, arithmetic, provenance, evidence packs. Zero runtime dependencies. |
| [`@kumokodo/tetrameter-sdk`](packages/sdk) | The collector. Records call metadata from the AI SDK, the Anthropic SDK or a patched `fetch`. Zero runtime dependencies. |

### Metadata only, structurally

No field in the SDK's record type can hold a prompt or a completion. `sanitize()` strips unknown
keys, and there is a test that spreads an entire provider response into a record and asserts the
content does not survive. The guarantee is enforced by the shape of the data, not by a policy
somebody has to remember.

That is what makes this usable in banks, healthcare, legal and government, where prompt-capturing
observability tools cannot go at any price. It is also why the collector is open: a security review
should be able to read it rather than take our word.

## What is in here that you would not expect

- **Every factor carries its source, version and retrieval date.** Model energy from the ML.ENERGY
  Benchmark, grid intensity from Ember via Our World in Data, pricing from the LiteLLM catalogue.
- **A restatement log.** When a coefficient changes, every historical figure derived from it moves,
  and in a disclosed inventory that is a restatement event requiring documentation. The log lives in
  the library so a report can cite it mechanically. It includes the entry from August 2026 where we
  had overstated a model roughly threefold.
- **Tests that pin uncomfortable results.** Renewable grids use *more* land per kilowatt-hour, not
  less. That is asserted in a test so nobody can quietly "fix" the result that makes the green answer
  look worse.
- **A reconciliation test** against Google's own published median energy figure for a Gemini prompt.
  If a change breaks that agreement, the build fails.

## What is deliberately not in here

Waste detection and recoverable-saving estimates are not open source. The line we drew: anything that
produces a number you would put in a disclosure is public; anything that produces a recommendation we
would bill for is not. Waste findings are hypotheses rather than measurements, so nobody needs to
audit them to trust a disclosure.

Also absent: ingest, storage, dashboards, per-customer attribution, and the twelve-month operational
record an auditor actually tests. That is the hosted product at
[tetrameter.ai](https://tetrameter.ai), and it is paid.

This library is not a trial that expires into a sales call. It is the thing we would want to exist if
we were the ones being asked to justify a number.

## Getting started

```bash
pnpm install
pnpm test
cd packages/core
npx vite-node test/smoke.demo.ts    # one agent trace, priced four ways
npx vite-node test/report.demo.ts   # a full evidence pack
```

## Boundaries we do not cross

Embodied carbon of the hardware, network transit, and the training run that produced the model are
all real and none is reliably attributable to a single inference. Inventing an allocation would be
exactly the kind of confident fiction this library exists to argue against, so we leave them out and
say so.

## Licence

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Apache 2.0 grants no trademark rights (section 6). The code is yours to use and fork; the name is
not. See [TRADEMARK.md](TRADEMARK.md) — in short, "built on Tetrameter" is always fine, calling your
fork Tetrameter is not.

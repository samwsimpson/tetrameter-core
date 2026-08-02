# @kumokodo/tetrameter-sdk

The metadata-only collector. Records what four-resource measurement needs — model,
token counts, timestamps, region, attribution — and **structurally cannot record
anything else**.

## Why the primitive is `record()`, not a wrapper

Decided by reading real code rather than by preference. SiteBeacon has *three*
integration shapes:

| Path | How | An SDK wrapper catches it? |
|---|---|---|
| Recognition fan-out | Vercel AI SDK `generateText` via AI Gateway | yes |
| `lib/aiAnalysis.ts` | raw `fetch` → Gemini REST | **no** |
| `outreach/rewrite-templates` | raw `fetch` → Anthropic REST | **no** |

A wrapper-first collector would have instrumented one of three and silently
missed the rest. So `record()` is a plain function callable from anywhere, and
the adapters are thin sugar on top.

## Three tiers of integration

Pick the least effort that gets you the data you need. You can start at the top
and deepen later without rework.

| Tier | Effort | What you get |
|---|---|---|
| **`register()`** | one import in `instrumentation.ts` | every provider call captured — cost, energy, carbon, water, land |
| **+ `traceRequest()`** | wrap a route handler | request-scoped traces, so agentic waste detection works |
| **+ `withTrace` / `setTraceMeta`** | one line where the outcome is known | true business outcomes, per-customer attribution, SCI |

```ts
// instrumentation.ts — Next.js runs this at server startup
import { register } from "@kumokodo/tetrameter-sdk/register";
register({ apiKey: process.env.TETRAMETER_KEY });
```

That is the whole integration for tier one. Patching only `fetch` — a stable web
standard rather than a vendor's internals — keeps it robust across SDK major
versions.

**What auto-instrumentation cannot do**, and no library can: infer that a call
belongs to `acme-corp`, or that 25 calls constitute one recognition report. That
is domain knowledge the app holds. `setTraceMeta({ customer })` stays yours to
call — and it is also exactly what makes this worth more than a proxy.

**No double counting.** If you use `register()` *and* the explicit adapters, each
call is recorded once. The adapters claim their async context and the patched
fetch beneath them stays quiet. Deduplicating by content would have been wrong:
SiteBeacon's discovery loop legitimately issues near-identical calls, and
dropping those would understate.

## Explicit integration

```ts
import {
  configure, withTrace, JsonlFileSink, instrumentGenerateText,
} from "@kumokodo/tetrameter-sdk";

configure({ sink: new JsonlFileSink("./tetrameter.jsonl") });
const generate = instrumentGenerateText(generateText, { team: "growth" });

await withTrace({ outcome: "recognition report", customer: orgId }, async () => {
  await Promise.all(FLEET.map((m) => callModel(m, messages, opts)));
});
```

The five fan-out calls become **one trace**, and `callModel` needs no changes —
`AsyncLocalStorage` carries the context. Asking a customer to thread a trace id
through every call site is how instrumentation projects die.

## Replay: a case study with no backend

```ts
const traces = toTraces(await readJsonl("./tetrameter.jsonl"), outcomes);
const pack = buildEvidencePack(traces, { entity: "SiteBeacon", … });
```

See `test/e2e.demo.ts`. No ingest service, no database, no deploy — which pulls
the first real case study months earlier than the roadmap assumed.

## Guarantees

**No content, structurally.** No field on `CallEvent` holds text, and `sanitize()`
strips unexpected keys before a record leaves the process — so
`record({ ...providerResponse })`, the mistake a hurried integration makes, cannot
leak a prompt. Two layers, because the type system doesn't protect JavaScript callers.

**Never breaks the host.** Every failure path reports and continues. A failed batch
is dropped rather than retried: an unbounded queue in a customer's process is a
memory leak that surfaces as *our* fault during *their* incident.

**Failed calls are recorded.** They still burned tokens, and a fan-out that drops
its failures reports a smaller footprint than it caused.

## One record per provider call, including the ones you gave up on

The rule is **one `record()` per request that left your process**, not one per
result you kept. It is the invariant integrations break most often, and it breaks
silently — the footprint simply comes out smaller than reality with nothing
missing from the output to hint at it.

Two ways it goes wrong, both found in real integrations rather than imagined:

**Failover collapses two calls into one.** A streamed request stalls, the client
falls back to a non-streaming call, and only the successful one is recorded. But
the abandoned request had already been accepted — the prompt was processed and
tokens were generated before anyone stopped reading. That consumption happened.
Record the abandoned attempt with whatever usage it managed to report, then
record the retry as its own call. Same for provider fallbacks, hedged requests
and any "try the next model" path: each attempt is a call.

**Zero tokens is a claim, not a default.** `inputTokens: 0, outputTokens: 0`
alongside `error` means *the provider reported no usage* — truthful when the
request was rejected before inference, as a 400 for a malformed request is.
It is not a placeholder for "the call failed so we don't know". A request
rejected after the prompt was processed burned real energy, and recording it as
zero moves that energy out of the inventory entirely. If usage is unavailable but
the call reached inference, record the token counts you sent rather than nothing.

The distinction matters because these are the calls nobody is watching. A failed
request produces no user-visible output, so an integration can drop it for months
and the only symptom is a carbon figure that looks slightly better than it should.

## Two bugs the build caught

- **`MultiSink` died on a synchronous throw.** `Promise.allSettled` only catches
  rejections; a sink throwing synchronously blew up inside `.map()` and took the
  healthy sinks with it.
- **`close()` lost in-flight writes.** Size-triggered flushes are fire-and-forget
  because `record()` is synchronous, so an exiting process silently dropped
  whatever was mid-write. Found by the end-to-end demo producing an empty capture.

Both have regression tests.

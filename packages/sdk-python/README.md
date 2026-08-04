# tetrameter (Python)

Metadata-only collector for measuring the energy, carbon, water and land of AI
inference. Sibling of [`@kumokodo/tetrameter-sdk`](../sdk); both produce identical
rows, so a company running Python and TypeScript sees one shape of data.

```bash
pip install tetrameter
```

```python
import tetrameter

tetrameter.configure()   # reads TETRAMETER_ENDPOINT and TETRAMETER_KEY

with tetrameter.trace(outcome="debate judged", customer=org_id):
    response = client.messages.create(...)
    tetrameter.record_anthropic_message(response, feature="reviewer")
    tetrameter.flush()
```

## What it will not do

**Carry prompt or completion text.** `sanitize` keeps a fixed allow-list of
fields and drops everything else, so `record(**response.__dict__)` cannot leak a
completion even by accident. A deny-list would need updating every time a provider
added a field, and the first time somebody forgot, prompt text would be stored.

**Raise.** `record()` swallows its own failures. Instrumentation that can break
the application it observes gets removed rather than fixed.

**Run without credentials.** `configure()` returns `None` when
`TETRAMETER_ENDPOINT` and `TETRAMETER_KEY` are not both set, and the collector
stays inert. A developer machine records nothing instead of writing
production-shaped rows into a production organisation.

**Block your request path.** All I/O happens on a background thread. A full
batch is handed over and `record()` returns immediately -- it used to send
inline, which stalled an asyncio event loop for the length of an HTTP round trip
every hundredth call. `flush()` is still synchronous, deliberately: it is what
you call at a trace boundary, and on a serverless platform the process can be
frozen the moment your handler returns, so a flush that only queued would lose
exactly the records you asked to send. From async code, call it off the loop:

```python
await asyncio.to_thread(tetrameter.flush)
```

**Retry a failed batch.** A retry queue inside a telemetry client is a memory leak
waiting for an outage. Ingest is idempotent on `(org, id)` so a retry made
elsewhere — a proxy, a load balancer — is harmless instead.

## Traces

A trace is one thing your business asked for. Wrap the outer function and every
call beneath it joins, with no id threaded through call sites.

Exactly one `trace` per delivered outcome: a nested one opens a second trace id
and splits one piece of work into two, understating the cost of both.

For runtimes that re-enter the same logical trace in separate invocations —
Inngest steps, for instance — pass `trace_id` explicitly. A fresh random id per
step turns eight steps into eight traces each claiming a whole outcome, which
multiplies the outcome count and divides the per-outcome footprint. Both
flattering.

## Adapters

| Function | For |
|---|---|
| `record_anthropic_message` | `anthropic.messages.create` |
| `record_openai_completion` | OpenAI chat completions |
| `record_embedding` | Any embedding call |
| `record_failure` | A call that raised |

Each reads usage counters and nothing else.

Two are worth explaining, because the TypeScript SDK shipped both bugs and this
package pins them from the start:

- **Anthropic's three token buckets stay apart.** `input_tokens` is ordinary,
  `cache_read_input_tokens` is the cheap one, and `cache_creation_input_tokens` is
  the *expensive* one — 1.25× input on the five-minute TTL, 2× on the one-hour.
  Folding writes into input under-prices the write turn while the reads after it
  stay exact, so any measured caching saving reads high.
- **Embeddings report usage under a different name**, and reading only one of them
  records every embedding as `0/0` with no error — indistinguishable from a call
  that genuinely cost nothing.

## Licence

Apache-2.0. The methodology is meant to be checked, so the code that produces the
numbers is readable.

## Releasing

Tagged, like the npm packages, and published by GitHub Actions through PyPI
Trusted Publishing — no API token exists anywhere.

```bash
git tag python-v0.1.0 && git push --tags
```

The workflow refuses to publish a tag whose version does not match
`pyproject.toml`, and verifies the built wheel actually contains the package and
its licence before uploading. Both checks are cheap, and a version on PyPI cannot
be replaced or yanked into non-existence afterwards — unlike npm there is not even
a 72-hour window.

One-time setup on PyPI, under the project's *Publishing* settings. Because
`tetrameter` has never been uploaded, this is added as a **pending publisher**,
which is how a project is bootstrapped without a token:

| Field | Value |
|---|---|
| PyPI project name | `tetrameter` |
| Owner | `samwsimpson` |
| Repository name | `tetrameter-core` |
| Workflow name | `publish-python.yml` |
| Environment name | `pypi-publish` |

Then create a GitHub environment called `pypi-publish` and restrict its
deployment branches and tags to `python-v*`, so the workflow can only run from a
release tag.

"""What this collector must not do.

Most of these are regressions against bugs the TypeScript SDK actually shipped
this month. A second implementation repeating them would be inexcusable rather
than unlucky, so each one is pinned here before the package has a single user.
"""

from __future__ import annotations

import sys
from pathlib import Path

import asyncio
import contextvars
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import tetrameter  # noqa: E402
from tetrameter import collector as collector_module  # noqa: E402  (the module, not the accessor)


@pytest.fixture(autouse=True)
def sink() -> tetrameter.MemorySink:
    collector_module._reset_for_tests()
    s = tetrameter.MemorySink()
    tetrameter.configure(sink=s, batch_size=1000)
    yield s
    collector_module._reset_for_tests()


class TestMetadataOnlyIsStructural:
    def test_strips_anything_that_could_carry_content(self, sink):
        # The mistake a hurried integration makes: record(**response.__dict__).
        tetrameter.record(
            model="claude-haiku-4-5",
            inputTokens=10,
            outputTokens=5,
            messages=[{"role": "user", "content": "a customer's private data"}],
            content="the completion",
            choices=[{"message": {"content": "secret"}}],
        )
        tetrameter.flush()
        assert len(sink.calls) == 1
        serialised = str(sink.calls)
        assert "private data" not in serialised
        assert "the completion" not in serialised
        assert "secret" not in serialised

    def test_keeps_an_allow_list_rather_than_a_deny_list(self):
        clean, dropped = tetrameter.sanitize(
            {"model": "m", "inputTokens": 1, "outputTokens": 2, "prompt": "x", "anything": 1}
        )
        assert sorted(clean) == ["inputTokens", "model", "outputTokens"]
        assert dropped == ["anything", "prompt"]

    def test_ignores_a_record_that_cannot_be_measured(self, sink):
        tetrameter.record(inputTokens=5, outputTokens=1)  # no model
        tetrameter.flush()
        assert sink.calls == []


class TestNeverRaises:
    def test_record_swallows_its_own_failures(self, sink):
        # If this can throw it will eventually throw inside somebody's request
        # handler, and the instrumentation gets deleted rather than fixed.
        class Hostile:
            def __str__(self) -> str:
                raise RuntimeError("boom")

        tetrameter.record(model=Hostile(), inputTokens=1, outputTokens=1)
        tetrameter.flush()  # must not raise

    def test_a_failing_sink_does_not_reach_the_caller(self):
        class Broken:
            def send(self, calls):
                raise RuntimeError("network gone")

        collector_module._reset_for_tests()
        tetrameter.configure(sink=Broken(), batch_size=1000)
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()  # must not raise


class TestInertWithoutCredentials:
    def test_configure_returns_none_and_records_nothing(self, monkeypatch):
        # The SiteBeacon failure, prevented by construction: a developer machine
        # with no credentials must not emit production-shaped rows.
        monkeypatch.delenv("TETRAMETER_ENDPOINT", raising=False)
        monkeypatch.delenv("TETRAMETER_KEY", raising=False)
        collector_module._reset_for_tests()
        assert tetrameter.configure() is None
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)  # a no-op
        tetrameter.flush()

    def test_a_key_without_an_endpoint_is_still_inert(self, monkeypatch):
        monkeypatch.delenv("TETRAMETER_ENDPOINT", raising=False)
        monkeypatch.setenv("TETRAMETER_KEY", "tm_something")
        collector_module._reset_for_tests()
        assert tetrameter.configure() is None


class TestTraceContext:
    def test_groups_a_fan_out_without_threading_an_id(self, sink):
        with tetrameter.trace(outcome="debate judged", customer="acme"):
            for model in ("claude-haiku-4-5", "gpt-4o-mini", "gemini-2.5-flash"):
                tetrameter.record(model=model, inputTokens=100, outputTokens=20)
        tetrameter.flush()

        assert len({c["traceId"] for c in sink.calls}) == 1
        assert all(c["customer"] == "acme" for c in sink.calls)
        assert all(c["outcome"] == "debate judged" for c in sink.calls)

    def test_numbers_calls_within_a_trace(self, sink):
        with tetrameter.trace():
            for _ in range(3):
                tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        assert [c["seq"] for c in sink.calls] == [0, 1, 2]

    def test_a_call_outside_a_trace_gets_its_own(self, sink):
        # Partial instrumentation degrades a number; it must never lose one.
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        assert len({c["traceId"] for c in sink.calls}) == 2

    def test_accepts_an_explicit_trace_id_for_re_entrant_runtimes(self, sink):
        # Inngest re-invokes from the top per step. A fresh random id per step
        # turns eight steps into eight traces, each claiming a whole outcome:
        # count times eight, per-outcome footprint divided by eight, both
        # flattering.
        for _ in range(3):
            with tetrameter.trace(trace_id="kodori-embed-document-42"):
                tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        assert len({c["traceId"] for c in sink.calls}) == 1

    def test_set_trace_meta_is_a_no_op_outside_a_trace(self):
        tetrameter.set_trace_meta(outcome="x")  # must not raise

    def test_a_call_level_value_beats_the_trace(self, sink):
        with tetrameter.trace(feature="chat"):
            tetrameter.record(model="m", inputTokens=1, outputTokens=1, feature="reviewer")
        tetrameter.flush()
        assert sink.calls[0]["feature"] == "reviewer"


class TestDeterministicIds:
    def test_the_same_call_derives_the_same_id(self, sink):
        # (org_id, id) with on-conflict-do-nothing is what makes a re-sent batch
        # harmless. A clock-derived id is unique per attempt rather than per call,
        # so the same batch twice conflicts with nothing and stores twice. The
        # server carried exactly that bug, unnoticed, because every sender
        # happened to supply its own id -- and a hand-rolled batcher is precisely
        # the client that would not have.
        for _ in range(2):
            with tetrameter.trace(trace_id="t1"):
                tetrameter.record(
                    model="m", inputTokens=10, outputTokens=2, timestamp="2026-08-04T10:00:00Z"
                )
        tetrameter.flush()
        assert sink.calls[0]["id"] == sink.calls[1]["id"]

    def test_two_different_calls_do_not_collide(self, sink):
        with tetrameter.trace(trace_id="t1"):
            tetrameter.record(
                model="m", inputTokens=10, outputTokens=2, timestamp="2026-08-04T10:00:00Z"
            )
            tetrameter.record(
                model="m", inputTokens=900, outputTokens=2, timestamp="2026-08-04T10:00:00Z"
            )
        tetrameter.flush()
        assert sink.calls[0]["id"] != sink.calls[1]["id"]

    def test_a_supplied_id_always_wins(self, sink):
        tetrameter.record(id="mine", model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        assert sink.calls[0]["id"] == "mine"


class TestAdapters:
    def test_anthropic_keeps_three_token_buckets_apart(self, sink):
        # Priced three ways: ordinary input, a cheap cache read, and a cache WRITE
        # billed at 1.25x. Folding the write into inputTokens under-prices the
        # write turn while the reads after it stay exact, so a measured caching
        # saving reads high. That was the TypeScript bug until 0.2.2.
        tetrameter.record_anthropic_message(
            {
                "model": "claude-sonnet-4-6",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 20,
                    "cache_creation_input_tokens": 8918,
                    "cache_read_input_tokens": 50,
                },
            }
        )
        tetrameter.flush()
        assert sink.calls[0]["inputTokens"] == 100
        assert sink.calls[0]["cacheWriteTokens"] == 8918
        assert sink.calls[0]["cachedTokens"] == 50

    def test_anthropic_omits_cache_fields_when_absent(self, sink):
        tetrameter.record_anthropic_message(
            {"model": "claude-sonnet-4-6", "usage": {"input_tokens": 100, "output_tokens": 20}}
        )
        tetrameter.flush()
        assert "cacheWriteTokens" not in sink.calls[0]

    def test_openai_reports_reasoning_without_double_counting_it(self, sink):
        # reasoning_tokens is already inside completion_tokens. Adding it would
        # double-count the most expensive tokens on the call.
        tetrameter.record_openai_completion(
            {
                "model": "o3",
                "usage": {
                    "prompt_tokens": 50,
                    "completion_tokens": 900,
                    "completion_tokens_details": {"reasoning_tokens": 850},
                },
            }
        )
        tetrameter.flush()
        assert sink.calls[0]["outputTokens"] == 900
        assert sink.calls[0]["reasoningTokens"] == 850

    def test_embeddings_read_usage_under_every_name_it_appears(self, sink):
        # The TypeScript adapter read inputTokens/promptTokens only, so every
        # embedding recorded 0/0 with no error -- indistinguishable from a call
        # that genuinely cost nothing.
        tetrameter.record_embedding({"model": "text-embedding-3-small", "usage": {"tokens": 8192}})
        tetrameter.record_embedding(
            {"model": "text-embedding-3-small", "usage": {"prompt_tokens": 512}}
        )
        tetrameter.flush()
        assert sink.calls[0]["inputTokens"] == 8192
        assert sink.calls[1]["inputTokens"] == 512
        # Zero output is a fact for an embedding, not a failure to read something.
        assert all(c["outputTokens"] == 0 for c in sink.calls)

    def test_an_unreadable_embedding_records_at_zero_and_warns(self, sink, caplog):
        tetrameter.record_embedding({"model": "text-embedding-3-small"})
        tetrameter.flush()
        assert sink.calls[0]["inputTokens"] == 0
        # Not marked error: the call succeeded, and a trace whose every call is
        # flagged failed is counted as producing no outcome at all.
        assert "error" not in sink.calls[0]
        assert "understates" in caplog.text

    def test_a_failure_is_recorded_rather_than_dropped(self, sink):
        tetrameter.record_failure(RuntimeError("provider outage"), model="m", feature="chat")
        tetrameter.flush()
        assert sink.calls[0]["error"] == "provider outage"
        assert sink.calls[0]["inputTokens"] == 0

    def test_adapters_read_objects_as_well_as_dicts(self, sink):
        # An SDK returns objects; a raw HTTP client returns dicts. Supporting only
        # one is how an adapter silently records zeros for half its users.
        class Usage:
            input_tokens = 7
            output_tokens = 3
            cache_read_input_tokens = None
            cache_creation_input_tokens = None

        class Response:
            model = "claude-haiku-4-5"
            usage = Usage()

        tetrameter.record_anthropic_message(Response())
        tetrameter.flush()
        assert sink.calls[0]["inputTokens"] == 7
        assert sink.calls[0]["outputTokens"] == 3


class TestBatching:
    def test_dispatches_when_the_batch_fills_without_blocking_the_caller(self):
        """A full batch goes on its own, and does NOT go on the caller's thread.

        This assertion changed when the sink moved to a background worker. It
        used to require the batch to be in the sink the instant the fifth record
        returned, which is only true if `record()` performed the HTTP round trip
        inline -- the stall the AI Colosseum integration hit on its event loop
        every hundredth model call. Delivery is now asynchronous, so the test
        waits for it instead of demanding it have already happened.
        """
        collector_module._reset_for_tests()
        s = tetrameter.MemorySink()
        tetrameter.configure(sink=s, batch_size=5)
        for _ in range(5):
            tetrameter.record(model="m", inputTokens=1, outputTokens=1)

        deadline = time.monotonic() + 5.0
        while len(s.calls) < 5 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(s.calls) == 5

    def test_an_explicit_flush_has_sent_by_the_time_it_returns(self):
        """The boundary guarantee, which stayed synchronous on purpose.

        A serverless process can be frozen the instant its handler returns, so a
        flush that merely queued would lose exactly the records somebody asked
        to send.
        """
        collector_module._reset_for_tests()
        s = tetrameter.MemorySink()
        tetrameter.configure(sink=s, batch_size=1000)
        for _ in range(3):
            tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        assert len(s.calls) == 3  # no waiting, no polling

    def test_a_slow_sink_does_not_stall_the_recording_thread(self):
        """The regression that started this. Recording must not pay for I/O."""
        collector_module._reset_for_tests()

        class SlowSink:
            def __init__(self) -> None:
                self.sent = 0

            def send(self, calls):
                time.sleep(1.0)
                self.sent += len(calls)

        tetrameter.configure(sink=SlowSink(), batch_size=5)
        started = time.perf_counter()
        for _ in range(10):  # crosses the batch boundary twice
            tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        elapsed = time.perf_counter() - started
        assert elapsed < 0.5, f"recording blocked for {elapsed:.2f}s on a slow sink"

    def test_flushing_twice_does_not_resend(self, sink):
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        tetrameter.flush()
        assert len(sink.calls) == 1


class TestSequenceUnderConcurrency:
    """The bug the AI Colosseum integration found, and why it mattered twice.

    `_seq` was a `ContextVar[int]`. `asyncio.gather` runs each awaitable in a
    Task, and a Task gets a COPY of the context -- so every branch of a fan-out
    read 0, incremented its own private copy, and emitted `seq=0`.

    Ordering was the visible symptom. The one that mattered more is that `seq`
    is part of `_derive_id` and is the field distinguishing two otherwise
    identical calls in one trace: pinned at 0, a fan-out issuing the same prompt
    to the same model twice derives ONE id for both, and ingest's
    `on conflict do nothing` keeps one of them. Silent loss, in a library whose
    entire purpose is not to undercount.
    """

    @pytest.mark.asyncio
    async def test_a_fan_out_gets_contiguous_positions(self):
        collector_module._reset_for_tests()
        s = tetrameter.MemorySink()
        tetrameter.configure(sink=s, batch_size=1000)

        async def one(i: int) -> None:
            tetrameter.record(model=f"m{i % 9}", inputTokens=10, outputTokens=2)

        with tetrameter.trace(outcome="audit"):
            await asyncio.gather(*(one(i) for i in range(99)))
        tetrameter.flush()

        seqs = sorted(c["seq"] for c in s.calls)
        assert seqs == list(range(99))

    @pytest.mark.asyncio
    async def test_identical_concurrent_calls_keep_distinct_ids(self):
        """Same model, same tokens, same trace, same instant — still distinct."""
        collector_module._reset_for_tests()
        s = tetrameter.MemorySink()
        tetrameter.configure(sink=s, batch_size=1000)

        async def one() -> None:
            tetrameter.record(
                model="m", inputTokens=10, outputTokens=2,
                timestamp="2026-08-03T15:50:00.000000Z",  # collapse the clock
            )

        with tetrameter.trace(outcome="audit"):
            await asyncio.gather(*(one() for _ in range(20)))
        tetrameter.flush()

        ids = [c["id"] for c in s.calls]
        assert len(set(ids)) == 20, "identical concurrent calls derived a colliding id"

    def test_threads_do_not_interleave_the_counter(self):
        collector_module._reset_for_tests()
        s = tetrameter.MemorySink()
        tetrameter.configure(sink=s, batch_size=1000)

        def one() -> None:
            tetrameter.record(model="m", inputTokens=1, outputTokens=1)

        with tetrameter.trace(outcome="audit"):
            with ThreadPoolExecutor(max_workers=8) as pool:
                # A FRESH context copy per submission. Sharing one `Context`
                # across threads raises "cannot enter context: already entered"
                # the moment two of them overlap -- which made the first version
                # of this test flaky rather than failing, because the error went
                # into a Future nobody read and the records simply never
                # happened. Results are checked below for the same reason.
                futures = [
                    pool.submit(contextvars.copy_context().run, one) for _ in range(200)
                ]
                for f in futures:
                    f.result()
        tetrameter.flush()

        seqs = sorted(c["seq"] for c in s.calls)
        assert seqs == list(range(200))


class TestReportedZeroIsNotAbsence:
    """A provider reporting 0 said something. A provider saying nothing did not.

    `record_openai_completion` used truthiness until 0.1.2, so an explicit
    `cached_tokens: 0` was discarded and became indistinguishable from a
    provider that never reports the field. The Anthropic adapter always had it
    right, so this was two rules in one file with the wrong one on the adapter
    serving every OpenAI-compatible provider.

    Reported by the AI Colosseum integration, which declined to adopt the
    adapter over it. Their argument is the one that makes it a defect rather
    than a nit: the calls explicitly reporting 0 are the DENOMINATOR of any
    cache hit-rate figure. Drop them and hit rate is computed only over calls
    that had a hit, and reads 100%.
    """

    def _usage(self, **kw):
        obj = type("U", (), {})()
        for k, v in kw.items():
            setattr(obj, k, v)
        return obj

    def _response(self, usage):
        r = type("R", (), {})()
        r.usage = usage
        r.model = "gpt-5.4-mini"
        return r

    def test_a_reported_zero_cache_read_is_recorded(self, sink):
        usage = self._usage(
            prompt_tokens=100,
            completion_tokens=20,
            prompt_tokens_details=self._usage(cached_tokens=0),
        )
        tetrameter.record_openai_completion(self._response(usage))
        tetrameter.flush()
        assert sink.calls[0]["cachedTokens"] == 0

    def test_an_unreported_cache_read_stays_absent(self, sink):
        usage = self._usage(prompt_tokens=100, completion_tokens=20)
        tetrameter.record_openai_completion(self._response(usage))
        tetrameter.flush()
        assert "cachedTokens" not in sink.calls[0]

    def test_a_reported_zero_reasoning_count_is_recorded(self, sink):
        usage = self._usage(
            prompt_tokens=100,
            completion_tokens=20,
            completion_tokens_details=self._usage(reasoning_tokens=0),
        )
        tetrameter.record_openai_completion(self._response(usage))
        tetrameter.flush()
        assert sink.calls[0]["reasoningTokens"] == 0

    def test_the_anthropic_adapter_agrees(self, sink):
        """Both adapters, one rule. They disagreed for two releases."""
        usage = self._usage(
            input_tokens=100,
            output_tokens=20,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
        )
        tetrameter.record_anthropic_message(self._response(usage))
        tetrameter.flush()
        assert sink.calls[0]["cachedTokens"] == 0
        assert sink.calls[0]["cacheWriteTokens"] == 0


class TestOutOfTraceSeq:
    def test_a_call_outside_a_trace_carries_position_zero(self, sink):
        """It is the only call in its own trace, so 0 is a fact not a fallback.

        The docstring said this; the code did not do it.
        """
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        assert sink.calls[0]["seq"] == 0


class TestAbsentUsageIsNotSilent:
    """A response with no usage counters records 0/0 — and now says so.

    The embeddings bug wearing a different hat, in the file whose docstring
    claims to have pre-empted it. `record_embedding` warned from the start; the
    completion adapters did not.

    Surfaced by testing an AI Colosseum claim instead of accepting it. They had
    concluded correctly that failures should not go through the completion
    adapter, but on the premise that `error` cannot ride through it — it can, as
    an attribution kwarg. The real reason is the two invented zeros.
    """

    def _resp(self, **kw):
        r = type("R", (), {})()
        for k, v in kw.items():
            setattr(r, k, v)
        return r

    def test_an_error_kwarg_does_ride_through_the_adapter(self, sink):
        usage = self._resp(prompt_tokens=10, completion_tokens=2)
        tetrameter.record_openai_completion(
            self._resp(usage=usage, model="m"), error="rate_limited"
        )
        tetrameter.flush()
        assert sink.calls[0]["error"] == "rate_limited"

    def test_a_usage_carrier_satisfies_the_contract(self, sink):
        """So a caller can keep completion text out of this module entirely."""
        usage = self._resp(prompt_tokens=10, completion_tokens=2)
        tetrameter.record_openai_completion(
            self._resp(usage=usage), model="m2", provider="cohere"
        )
        tetrameter.flush()
        assert sink.calls[0]["model"] == "m2"
        assert sink.calls[0]["provider"] == "cohere"
        assert sink.calls[0]["inputTokens"] == 10

    def test_absent_usage_warns_rather_than_recording_a_silent_zero(self, sink, caplog):
        import logging

        with caplog.at_level(logging.WARNING, logger="tetrameter"):
            tetrameter.record_openai_completion(self._resp(model="m"), error="abandoned")
        tetrameter.flush()
        assert sink.calls[0]["inputTokens"] == 0
        assert "no usage counters" in caplog.text
        assert "record_failure" in caplog.text

    def test_it_does_not_mark_the_call_failed_on_our_behalf(self, sink):
        """Our reading failed, not necessarily the call.

        Marking it failed would tell the engine no work was delivered, turning a
        measurement gap into a missing unit of work.
        """
        tetrameter.record_openai_completion(self._resp(model="m"))
        tetrameter.flush()
        assert "error" not in sink.calls[0]

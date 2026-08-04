"""What this collector must not do.

Most of these are regressions against bugs the TypeScript SDK actually shipped
this month. A second implementation repeating them would be inexcusable rather
than unlucky, so each one is pinned here before the package has a single user.
"""

from __future__ import annotations

import sys
from pathlib import Path

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
    def test_flushes_when_the_batch_fills(self):
        collector_module._reset_for_tests()
        s = tetrameter.MemorySink()
        tetrameter.configure(sink=s, batch_size=5)
        for _ in range(5):
            tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        assert len(s.calls) == 5  # sent without an explicit flush

    def test_flushing_twice_does_not_resend(self, sink):
        tetrameter.record(model="m", inputTokens=1, outputTokens=1)
        tetrameter.flush()
        tetrameter.flush()
        assert len(sink.calls) == 1

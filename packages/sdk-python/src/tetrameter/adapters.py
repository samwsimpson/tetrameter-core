"""Provider adapters.

Each one reads usage counters and nothing else. They cannot leak a completion
because they never read one -- the response's content is not touched, and would
be discarded by `sanitize` even if it were.

Both bugs the TypeScript SDK shipped this month are pre-empted here, because a
new SDK repeating them would be inexcusable rather than unlucky:

  - Embeddings report usage under a different name. The AI SDK adapter read
    inputTokens/promptTokens and embeddings carry `tokens`, so every embedding
    recorded as 0/0 with no error -- indistinguishable from a call that genuinely
    cost nothing.
  - Anthropic's cache counters are separate from ordinary input, and a cache
    WRITE is billed at a premium (1.25x on the five-minute TTL, 2x on the
    one-hour). Folding writes into inputTokens under-prices the write turn while
    the read turns after it stay exact, so any measured caching saving reads high
    -- an error in the flattering direction.
"""

from __future__ import annotations

import logging
from typing import Any

from .collector import record

log = logging.getLogger("tetrameter")


def _get(obj: Any, name: str, default: Any = None) -> Any:
    """Read an attribute or a key. SDKs return objects; raw HTTP returns dicts."""
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def record_anthropic_message(response: Any, **attribution: Any) -> None:
    """Record an ``anthropic.messages.create`` response.

    The three token buckets stay apart because Anthropic prices them three ways:
    ``input_tokens`` is ordinary, ``cache_read_input_tokens`` is the cheap one,
    and ``cache_creation_input_tokens`` is the expensive one. Folding the last
    into the first is the bug the TypeScript SDK carried until 0.2.2.
    """
    usage = _get(response, "usage")
    fields: dict[str, Any] = {
        "model": attribution.pop("model", None) or _get(response, "model") or "unknown",
        "provider": attribution.pop("provider", None) or "anthropic",
        "inputTokens": _get(usage, "input_tokens", 0) or 0,
        "outputTokens": _get(usage, "output_tokens", 0) or 0,
    }

    cache_read = _get(usage, "cache_read_input_tokens")
    if cache_read is not None:
        fields["cachedTokens"] = cache_read
    cache_write = _get(usage, "cache_creation_input_tokens")
    if cache_write is not None:
        fields["cacheWriteTokens"] = cache_write

    record(**fields, **attribution)


# Counters each adapter already reads. Anything else in a usage object is
# something we are not measuring.
_ANTHROPIC_KNOWN_USAGE = frozenset(
    {"input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"}
)
_OPENAI_KNOWN_USAGE = frozenset(
    {
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "completion_tokens_details",
        "prompt_tokens_details",
        "reasoning_tokens",
        "cached_tokens",
    }
)

_seen_unknown: set[tuple[str, str]] = set()


def _log_unknown_usage_fields(usage: Any, provider: str, known: frozenset[str]) -> None:
    """Name any usage counter we are not reading. Once per (provider, field).

    Contributed by the AI Colosseum integration, and the reasoning is the part
    worth keeping: **"this provider does not report X" and "we are reading the
    wrong key for X" are the same observation** — an absent field — and nothing
    in the data distinguishes them. A library that silently reads a fixed list
    of names can be wrong about a provider forever and look complete doing it.

    That is not hypothetical here. Nobody involved could establish how the
    Vercel AI Gateway reports an Anthropic explicit-cache write through its
    OpenAI-compatible surface; its documented usage object is
    ``{prompt_tokens, completion_tokens, total_tokens}`` and says nothing about
    one. Rather than upstream a guessed spelling as though it were known, this
    logs what actually arrives so the real name can be *observed* once somebody
    writes a cache.

    **Field names only, never values.** Names are schema and safe to log; a
    library whose entire guarantee is metadata-only should not be putting
    counters into somebody's log aggregator as a side effect of a diagnostic.

    INFO, and once per process per field, because a bulk job emitting this per
    call is how instrumentation gets removed rather than read.
    """
    try:
        if usage is None:
            return
        if hasattr(usage, "model_dump"):
            fields = usage.model_dump()
        elif isinstance(usage, dict):
            fields = usage
        else:
            fields = vars(usage)

        for name, value in fields.items():
            if name in known or name.startswith("_") or value is None:
                continue
            # Nested detail objects are traversed one level; a counter hiding in
            # `prompt_tokens_details` is exactly the case this is looking for.
            if isinstance(value, dict):
                for inner in value:
                    if inner not in known and not inner.startswith("_"):
                        _warn_unknown(provider, name + "." + inner)
                continue
            if isinstance(value, (int, float)):
                _warn_unknown(provider, name)
    except Exception:  # noqa: BLE001 - a diagnostic must never break a record
        return


def _warn_unknown(provider: str, field: str) -> None:
    if (provider, field) in _seen_unknown:
        return
    _seen_unknown.add((provider, field))
    log.info(
        "tetrameter: %s reports a usage counter this SDK does not read: %r. "
        "If it is a token count we should be measuring, please report the name.",
        provider,
        field,
    )


def record_openai_completion(response: Any, **attribution: Any) -> None:
    """Record an OpenAI chat completion.

    ``reasoning_tokens`` sits inside ``completion_tokens_details`` and is already
    counted in ``completion_tokens``, so it is reported separately rather than
    added -- adding it would double-count the most expensive tokens on the call.
    """
    usage = _get(response, "usage")
    details = _get(usage, "completion_tokens_details")

    fields: dict[str, Any] = {
        "model": attribution.pop("model", None) or _get(response, "model") or "unknown",
        "provider": attribution.pop("provider", None) or "openai",
        "inputTokens": _get(usage, "prompt_tokens", 0) or 0,
        "outputTokens": _get(usage, "completion_tokens", 0) or 0,
    }

    # `is not None`, not truthiness. A provider reporting 0 is stating a fact;
    # a provider saying nothing is stating none. Collapsing them is how
    # under-measurement hides.
    #
    # This adapter used `if reasoning:` and `if cached:` until 0.1.2, so an
    # explicit `cached_tokens: 0` was discarded and became indistinguishable
    # from a provider that never reports the field. The Anthropic adapter above
    # always had it right, which made this two rules in one file with the wrong
    # one on the adapter that serves every OpenAI-compatible provider.
    #
    # The consequence is not academic. Reported by the AI Colosseum integration,
    # which declined to adopt this adapter because of it: 201 of their 264 rows
    # carry a cache read, and the calls explicitly reporting 0 are the
    # DENOMINATOR of any hit-rate figure. Drop the zeros and hit rate is
    # computed only over calls that had a hit, and reads 100%.
    #
    # It is the embeddings bug inverted. There a missing counter became a silent
    # zero; here a real zero became a silent absence. Both understate what is
    # known about the call.
    reasoning = _get(details, "reasoning_tokens")
    if reasoning is not None:
        fields["reasoningTokens"] = reasoning

    cached = _get(_get(usage, "prompt_tokens_details"), "cached_tokens")
    if cached is not None:
        fields["cachedTokens"] = cached

    _log_unknown_usage_fields(usage, fields["provider"], _OPENAI_KNOWN_USAGE)
    record(**fields, **attribution)


def record_embedding(response: Any, **attribution: Any) -> None:
    """Record an embedding call.

    Separate from the completion adapters because only an embedding call site
    knows that zero output tokens is a FACT rather than a failure to read
    something. There is no completion to bill.

    The usage shape differs again -- OpenAI reports ``prompt_tokens``, others
    report ``tokens`` -- and reading only one of them is how the TypeScript
    adapter recorded every embedding as 0/0 for a fortnight without an error.
    """
    usage = _get(response, "usage")
    tokens = _get(usage, "prompt_tokens")
    if tokens is None:
        tokens = _get(usage, "tokens")
    if tokens is None:
        tokens = _get(usage, "total_tokens")

    if tokens is None:
        # Recorded at zero and said out loud. Dropping it would lose the call
        # entirely; recording it silently would make an unmeasured call look free,
        # which is the failure this whole library exists to prevent.
        import logging

        logging.getLogger("tetrameter").warning(
            "tetrameter: an embedding response carried no readable usage; recording 0 tokens. "
            "A silent zero here understates the footprint."
        )
        tokens = 0

    record(
        model=attribution.pop("model", None) or _get(response, "model") or "unknown",
        provider=attribution.pop("provider", None) or "openai",
        inputTokens=tokens,
        outputTokens=0,
        **attribution,
    )


def record_failure(error: BaseException | str, **attribution: Any) -> None:
    """Record a call that failed.

    A failed call still consumed tokens on the provider's side in most cases, and
    a fan-out that silently drops its failures reports a smaller footprint than it
    caused. Zero tokens with an error set is honest; no row at all is not.
    """
    message = str(error)
    record(
        model=attribution.pop("model", None) or "unknown",
        inputTokens=attribution.pop("inputTokens", 0),
        outputTokens=attribution.pop("outputTokens", 0),
        error=message[:200],
        **attribution,
    )

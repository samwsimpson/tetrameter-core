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

from typing import Any

from .collector import record


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

    reasoning = _get(details, "reasoning_tokens")
    if reasoning:
        fields["reasoningTokens"] = reasoning

    cached = _get(_get(usage, "prompt_tokens_details"), "cached_tokens")
    if cached:
        fields["cachedTokens"] = cached

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

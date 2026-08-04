"""The wire model, and the reason it is an allow-list.

Metadata-only is structural here, not a policy. `sanitize` keeps a fixed set of
fields and discards everything else, so a caller who does the natural thing --
``record(**response.__dict__)`` -- cannot leak a completion even by accident. A
deny-list would need updating every time a provider adds a field, and the first
time somebody forgot, prompt text would be stored.

This mirrors ``packages/sdk`` field for field. A Python sender and a TypeScript
sender must produce identical rows or a customer running both gets two shapes of
data in one organisation.
"""

from __future__ import annotations

from typing import Any, Final

#: Every field the ingest endpoint accepts. Anything else is dropped and named.
ALLOWED_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "id",
        "traceId",
        "timestamp",
        "provider",
        "model",
        "inputTokens",
        "outputTokens",
        "seq",
        "cachedTokens",
        "cacheWriteTokens",
        "reasoningTokens",
        "region",
        "durationMs",
        "billedCostUsd",
        "team",
        "feature",
        "customer",
        "outcome",
        "outcomeCount",
        "error",
    }
)

#: Fields a call is meaningless without. Checked before anything is queued.
REQUIRED_FIELDS: Final[tuple[str, ...]] = ("model", "inputTokens", "outputTokens")


def sanitize(event: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Keep only known fields. Returns the clean event and what was dropped.

    The dropped names are returned rather than logged here so the collector can
    decide what to do with them -- warning once is useful, warning per call
    during a bulk job is how instrumentation gets removed.
    """
    clean: dict[str, Any] = {}
    dropped: list[str] = []
    for key, value in event.items():
        if key in ALLOWED_FIELDS:
            if value is not None:
                clean[key] = value
        else:
            dropped.append(key)
    return clean, sorted(dropped)

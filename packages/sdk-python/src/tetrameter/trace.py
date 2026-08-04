"""Ambient trace context.

A trace is one thing your business asked for. Wrapping the outer function is
enough -- every ``record`` beneath it joins, with no id threaded through call
sites, because threading an id through every call site is how instrumentation
projects die.

``contextvars`` rather than a global, so this is correct under asyncio and under
threads. A module-level variable would attribute one request's calls to another
the first time two ran concurrently, which is the kind of bug that only appears
under load and looks like a data problem rather than a code one.
"""

from __future__ import annotations

import threading
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_trace: ContextVar[dict[str, Any] | None] = ContextVar("tetrameter_trace", default=None)

# Guards the counter that lives INSIDE the trace dict. See ``next_seq``.
_seq_lock = threading.Lock()


def new_trace_id() -> str:
    """Correlation key, not a security token. Collision resistance is what matters."""
    return str(uuid.uuid4())


@contextmanager
def trace(
    *,
    outcome: str | None = None,
    customer: str | None = None,
    team: str | None = None,
    feature: str | None = None,
    outcome_count: int | None = None,
    trace_id: str | None = None,
) -> Iterator[str]:
    """Run a block inside one trace.

    Exactly one per delivered outcome. A nested one opens a second trace id and
    splits one piece of work into two, which understates the cost of both -- if
    the boundary is not obvious, put it where you would draw the line for a
    customer invoice.

    ``trace_id`` is accepted for runtimes that re-enter the same logical trace in
    separate invocations. Inngest does exactly this, and a fresh random id per
    step turns eight steps into eight traces each claiming a whole outcome.
    """
    ctx = {
        # The sequence counter lives in this dict rather than in a ContextVar of
        # its own, and the difference is the whole bug described in ``next_seq``.
        "_seq": 0,
        "traceId": trace_id or new_trace_id(),
        "outcome": outcome,
        "customer": customer,
        "team": team,
        "feature": feature,
        "outcomeCount": outcome_count,
    }
    token = _trace.set(ctx)
    try:
        yield ctx["traceId"]
    finally:
        _trace.reset(token)


def current_trace() -> dict[str, Any] | None:
    return _trace.get()


def set_trace_meta(**meta: Any) -> None:
    """Enrich the current trace after it has started.

    The outcome is frequently unknown when a handler opens -- it loads the
    organisation, works out what it is doing, and only then knows. Requiring both
    up front would push ``trace`` deeper into the application, which is the
    threading problem it exists to avoid.

    A no-op outside a trace rather than an error: enrichment must never be the
    thing that breaks a request.
    """
    ctx = _trace.get()
    if ctx is None:
        return
    for key, value in meta.items():
        if value is not None:
            ctx[key] = value


def next_seq() -> int:
    """Monotonic within a trace, so fan-out order survives a batching transport.

    ── Why the counter is in the trace dict and not a ContextVar ───────────────

    It was a ``ContextVar[int]``, and that is wrong in exactly the situation it
    exists for. ``asyncio.gather`` runs each awaitable in a Task, and a Task gets
    a *copy* of the current context. ``_seq.set(value + 1)`` then mutates only
    that Task's copy, so every branch of a fan-out read 0, wrote 1 into its own
    private copy, and emitted ``seq=0``. Reported by the AI Colosseum
    integration, whose audit fans out 99 ways; reproduced here as 99 records
    carrying one distinct sequence value.

    The trace dict never had this problem because a context copy shares the same
    dict OBJECT — mutating it is visible everywhere, which is also why
    ``set_trace_meta`` works across tasks. So the counter moves into the dict and
    inherits the semantics that were already correct.

    ── Why it is worse than mis-ordering ──────────────────────────────────────

    ``seq`` is part of ``_derive_id``, and it is the field that distinguishes two
    otherwise identical calls in the same trace. Pinned at 0, a fan-out issuing
    the same prompt to the same model twice in the same microsecond derives one
    id for both, and ingest's ``on conflict do nothing`` silently keeps one. The
    id comment promises the opposite. So this degraded idempotency into possible
    data loss, not just into scrambled order.

    The lock is for threads: a ``ThreadPoolExecutor`` fan-out shares one dict and
    would otherwise interleave read-modify-write. Tasks on one event loop never
    interleave here — there is no await between the read and the write — but a
    lock costs nothing and covers both.
    """
    ctx = _trace.get()
    if ctx is None:
        # Outside a trace every call gets a trace of its own, so it is the only
        # call in that trace and position 0 is the truth rather than a fallback.
        return 0
    with _seq_lock:
        value = int(ctx.get("_seq", 0))
        ctx["_seq"] = value + 1
        return value

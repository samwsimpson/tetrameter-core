"""The collector: batching, flushing, and the rules that keep it honest."""

from __future__ import annotations

import atexit
import hashlib
import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any

from .sinks import HttpSink, Sink
from .trace import current_trace, new_trace_id, next_seq
from .types import REQUIRED_FIELDS, sanitize

log = logging.getLogger("tetrameter")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _derive_id(event: dict[str, Any]) -> str:
    """A stable id for a call that did not bring one.

    DETERMINISTIC, deliberately. (org_id, id) with on-conflict-do-nothing is what
    makes a re-sent batch harmless, and an id derived from the clock is unique per
    attempt rather than per call -- so the same batch sent twice conflicts with
    nothing and stores everything twice.

    The server grew that exact bug and it went unnoticed for days, because every
    sender happened to supply its own id. A hand-rolled batcher is precisely the
    client that would not have, which is most of why this package exists.

    Content-derived, so an identical re-send collapses and two genuinely different
    calls at the same position do not.
    """
    material = "\0".join(
        str(event.get(field, ""))
        for field in ("traceId", "seq", "timestamp", "model", "inputTokens", "outputTokens")
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]


class Collector:
    """Buffers records and sends them in batches.

    One collector per process, guarded by a lock, rather than one per thread. A
    per-thread buffer flushes partially and unpredictably, and a trace that fanned
    out across a pool would arrive in pieces.
    """

    def __init__(self, sink: Sink, *, batch_size: int = 100, region: str | None = None) -> None:
        self._sink = sink
        self._batch_size = batch_size
        self._region = region
        self._buffer: list[dict[str, Any]] = []
        self._lock = threading.Lock()
        self._warned_dropped: set[str] = set()

    def record(self, **event: Any) -> None:
        """Record one call. Never raises.

        If this can throw it will eventually throw inside somebody's request
        handler, and the instrumentation gets deleted rather than fixed.
        """
        try:
            self._record(event)
        except Exception as err:  # noqa: BLE001 - see docstring
            log.warning("tetrameter: dropped a record: %s", err)

    def _record(self, event: dict[str, Any]) -> None:
        clean, dropped = sanitize(event)

        # Warned once per field NAME, not per call. A bulk job would otherwise
        # print thousands of identical lines and get the collector removed.
        for name in dropped:
            if name not in self._warned_dropped:
                self._warned_dropped.add(name)
                log.warning(
                    "tetrameter: dropped unknown field %r. The wire model is metadata-only "
                    "and has nowhere to put prompt or completion text.",
                    name,
                )

        missing = [f for f in REQUIRED_FIELDS if f not in clean]
        if missing:
            log.warning("tetrameter: ignoring a record missing %s", ", ".join(missing))
            return

        ctx = current_trace()
        if ctx is not None:
            clean.setdefault("traceId", ctx["traceId"])
            for field in ("outcome", "customer", "team", "feature", "outcomeCount"):
                if ctx.get(field) is not None:
                    clean.setdefault(field, ctx[field])
            clean.setdefault("seq", next_seq())
        else:
            # A call outside any trace is not dropped -- it gets a trace of its
            # own. Partial instrumentation should degrade a number, never lose it.
            clean.setdefault("traceId", new_trace_id())

        clean.setdefault("timestamp", _now_iso())
        if self._region is not None:
            clean.setdefault("region", self._region)
        clean.setdefault("id", _derive_id(clean))

        with self._lock:
            self._buffer.append(clean)
            ready = len(self._buffer) >= self._batch_size
        if ready:
            self.flush()

    def flush(self) -> None:
        """Send whatever is buffered. Never raises."""
        with self._lock:
            batch, self._buffer = self._buffer, []
        if not batch:
            return
        try:
            self._sink.send(batch)
        except Exception as err:  # noqa: BLE001
            log.warning("tetrameter: flush failed, dropping %d records: %s", len(batch), err)


_collector: Collector | None = None


def configure(
    *,
    sink: Sink | None = None,
    url: str | None = None,
    api_key: str | None = None,
    batch_size: int = 100,
    region: str | None = None,
) -> Collector | None:
    """Set up the process-wide collector.

    Returns None when there is nothing to send to, and that is the important
    behaviour rather than an edge case: with no key configured the collector is
    INERT. A developer machine without credentials records nothing, instead of
    emitting production-shaped rows into a production organisation -- a mistake
    this project has already made once and spent a day untangling.
    """
    global _collector

    resolved_url = url or os.environ.get("TETRAMETER_ENDPOINT")
    resolved_key = api_key or os.environ.get("TETRAMETER_KEY")
    resolved_region = region or os.environ.get("TETRAMETER_REGION")

    if sink is None:
        if not resolved_url or not resolved_key:
            log.info(
                "tetrameter: inert - TETRAMETER_ENDPOINT and TETRAMETER_KEY are not both set, "
                "so nothing will be recorded."
            )
            _collector = None
            return None
        sink = HttpSink(resolved_url, resolved_key)

    _collector = Collector(sink, batch_size=batch_size, region=resolved_region)
    # Short-lived workers exit before any timer would fire, so the buffer is
    # drained on the way out. Anything long-lived should still flush at its own
    # trace boundaries rather than relying on this.
    atexit.register(_collector.flush)
    return _collector


def current_collector() -> Collector | None:
    """The configured collector, or None when inert.

    Named `current_collector` rather than `collector` because the module is also
    called `collector`: exporting both meant `tetrameter.collector` resolved to
    whichever was imported last, which is the kind of ambiguity that produces a
    bug report nobody can reproduce.
    """
    return _collector


def record(**event: Any) -> None:
    """Record a call against the configured collector. A no-op when inert."""
    if _collector is not None:
        _collector.record(**event)


def flush() -> None:
    if _collector is not None:
        _collector.flush()


def _reset_for_tests() -> None:
    global _collector
    _collector = None

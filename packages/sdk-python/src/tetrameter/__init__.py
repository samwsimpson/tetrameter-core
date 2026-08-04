"""Tetrameter's Python collector.

Metadata only: model names, token counts, timings and attribution labels. The
wire model has nowhere to put a prompt or a completion, which is why this passes
security reviews that prompt-storing tools fail.

    import tetrameter

    tetrameter.configure()            # reads TETRAMETER_ENDPOINT and TETRAMETER_KEY

    with tetrameter.trace(outcome="debate judged", customer=org_id):
        response = client.messages.create(...)
        tetrameter.record_anthropic_message(response, feature="reviewer")
        tetrameter.flush()

`configure()` with no credentials returns None and the collector stays inert, so
a developer machine records nothing rather than emitting production-shaped rows.
"""

from .collector import Collector, configure, current_collector, flush, record
from .sinks import HttpSink, MemorySink, Sink
from .trace import current_trace, new_trace_id, next_seq, set_trace_meta, trace
from .types import ALLOWED_FIELDS, REQUIRED_FIELDS, sanitize
from .adapters import (
    record_anthropic_message,
    record_embedding,
    record_failure,
    record_openai_completion,
)

__version__ = "0.1.3"

__all__ = [
    "ALLOWED_FIELDS",
    "REQUIRED_FIELDS",
    "Collector",
    "HttpSink",
    "MemorySink",
    "Sink",
    "current_collector",
    "configure",
    "current_trace",
    "flush",
    "new_trace_id",
    "next_seq",
    "record",
    "record_anthropic_message",
    "record_embedding",
    "record_failure",
    "record_openai_completion",
    "sanitize",
    "set_trace_meta",
    "trace",
    "__version__",
]

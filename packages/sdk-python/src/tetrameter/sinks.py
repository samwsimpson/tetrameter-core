"""Where records go.

Every sink swallows its own failures. Instrumentation that can break the
application it observes gets removed, so this one cannot: a dropped batch is a
gap in a figure, and a raised exception is an outage.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Any, Protocol

log = logging.getLogger("tetrameter")


class Sink(Protocol):
    def send(self, calls: list[dict[str, Any]]) -> None: ...


class MemorySink:
    """For tests, and for anyone who wants to assert on what would be sent."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def send(self, calls: list[dict[str, Any]]) -> None:
        self.calls.extend(calls)


class HttpSink:
    """POST a batch to the ingest endpoint.

    Deliberately drops a failed batch rather than retrying. A retry queue inside
    a telemetry client is a memory leak waiting for an outage, and the ingest
    endpoint is idempotent on (org, id) precisely so that a retry made somewhere
    else -- a proxy, a load balancer -- is harmless rather than double-counted.
    """

    def __init__(self, url: str, api_key: str, timeout: float = 10.0) -> None:
        self._url = url
        self._api_key = api_key
        self._timeout = timeout

    def send(self, calls: list[dict[str, Any]]) -> None:
        body = json.dumps({"calls": calls}).encode("utf-8")
        request = urllib.request.Request(
            self._url,
            data=body,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": "Bearer " + self._api_key,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                if response.status >= 300:
                    log.warning("tetrameter: ingest returned %s", response.status)
        except urllib.error.HTTPError as err:
            # 401 is the one worth naming. It means the key is wrong and NOTHING
            # is being recorded, which otherwise looks exactly like no traffic --
            # and "no traffic" is the reading somebody will accept for a week.
            hint = " - check TETRAMETER_KEY" if err.code == 401 else ""
            log.warning("tetrameter: ingest rejected the batch (%s)%s", err.code, hint)
        except Exception as err:  # noqa: BLE001 - telemetry must never raise
            log.warning("tetrameter: could not send batch: %s", err)

"""Framework-neutral guard: verify the event id a request carries, then let your rules decide.

The Django, Flask and FastAPI adapters in this package are thin wrappers over :class:`Guard`.
"""

import json
import os
from typing import Any, Callable, Dict, Mapping, Optional

from . import Client, Event, VerifyError

__all__ = ["Guard", "GuardOutcome", "event_id_from"]

# Transient failures: Trace is unreachable or busy. Everything else about the event itself is a client error.
_TRANSIENT = {"timeout", "network", "server_error", "rate_limited", "limit_reached", "invalid_response"}


class GuardOutcome:
    """ok=True: continue, `event` is the verified event (None when fail_open let the request through or no id was
    required). ok=False: answer with `status` and `body()`."""

    def __init__(self, ok: bool, event: Optional[Event] = None, status: int = 200, code: str = "", message: str = ""):
        self.ok = ok
        self.event = event
        self.status = status
        self.code = code
        self.message = message

    def body(self) -> Dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message}}


def event_id_from(headers: Optional[Mapping[str, str]], body: Any, header: str = "X-Trace-Event-Id", body_field: str = "eventId") -> Optional[str]:
    """The event id from a header (case-insensitive lookup left to the mapping) or a parsed JSON body."""
    if headers is not None:
        value = headers.get(header) or headers.get(header.lower())
        if isinstance(value, str) and value.strip():
            return value.strip()
    if isinstance(body, dict):
        value = body.get(body_field)
        if isinstance(value, str) and value:
            return value
    return None


def parse_json(raw: Any) -> Any:
    """Parses a request body as JSON; anything unreadable is None."""
    try:
        if isinstance(raw, (bytes, bytearray)):
            raw = bytes(raw).decode("utf-8")
        return json.loads(raw) if raw else None
    except (ValueError, UnicodeDecodeError):
        return None


class Guard:
    """Verifies an event id with your secret key.

    * `secret_key` / `endpoint` default to the TRACE_SECRET_KEY and TRACE_ENDPOINT environment variables.
    * `required`: reject requests with no event id (default True).
    * `fail_open`: when Trace is unreachable, let the request through with `event` None instead of answering 503. A wrong
      key or missing configuration never fails open.
    * `reject(event) -> bool`: return True to answer 403. Runs only on a verified event.
    """

    def __init__(
        self,
        secret_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        timeout: float = 2.0,
        header: str = "X-Trace-Event-Id",
        body_field: str = "eventId",
        required: bool = True,
        fail_open: bool = False,
        reject: Optional[Callable[[Event], bool]] = None,
    ):
        self.secret_key = secret_key
        self.endpoint = endpoint
        self.timeout = timeout
        self.header = header
        self.body_field = body_field
        self.required = required
        self.fail_open = fail_open
        self.reject = reject

    def event_id(self, headers: Optional[Mapping[str, str]], body: Any) -> Optional[str]:
        return event_id_from(headers, body, self.header, self.body_field)

    def check(self, event_id: Optional[str]) -> GuardOutcome:
        if not event_id:
            if not self.required:
                return GuardOutcome(True)
            return GuardOutcome(False, status=400, code="event_required", message="Missing Trace event id")
        secret_key = self.secret_key or os.environ.get("TRACE_SECRET_KEY")
        endpoint = self.endpoint or os.environ.get("TRACE_ENDPOINT")
        if not secret_key or not endpoint:
            return GuardOutcome(False, status=500, code="trace_misconfigured", message="Set secret_key and endpoint (or TRACE_SECRET_KEY and TRACE_ENDPOINT)")
        try:
            event = Client(secret_key, endpoint, self.timeout).get_event(event_id)
        except VerifyError as err:
            if err.code in _TRANSIENT:
                if self.fail_open:
                    return GuardOutcome(True)
                return GuardOutcome(False, status=503, code="trace_unavailable", message="Trace could not verify the event")
            if err.code == "unauthorized":
                return GuardOutcome(False, status=500, code="trace_misconfigured", message="Trace rejected the secret key")
            return GuardOutcome(False, status=400, code="event_invalid", message="The Trace event id is invalid or expired")
        if self.reject is not None and self.reject(event):
            return GuardOutcome(False, status=403, code="trace_rejected", message="Request rejected")
        return GuardOutcome(True, event)

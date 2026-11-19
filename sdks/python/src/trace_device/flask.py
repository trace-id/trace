"""Flask adapter. Needs Flask installed.

    from trace_device.flask import trace_guard

    @app.post("/signup")
    @trace_guard(reject=lambda e: e["suspectScore"] >= 80)
    def signup():
        visitor = g.trace["visitorId"]  # g.trace is None only with fail_open or required=False
"""

import functools
from typing import Any, Callable

from .guard import Guard

__all__ = ["trace_guard"]


def trace_guard(guard: Any = None, **options: Any) -> Callable:
    """Route decorator. Pass a :class:`Guard`, or its keyword options. Sets `flask.g.trace` to the verified event."""
    g = guard if isinstance(guard, Guard) else Guard(**options)

    def decorator(view: Callable) -> Callable:
        @functools.wraps(view)
        def wrapped(*args, **kwargs):
            from flask import g as flask_g
            from flask import request

            event_id = g.event_id(request.headers, request.get_json(silent=True) or request.form)
            outcome = g.check(event_id)
            if not outcome.ok:
                return outcome.body(), outcome.status
            flask_g.trace = outcome.event
            return view(*args, **kwargs)

        return wrapped

    return decorator

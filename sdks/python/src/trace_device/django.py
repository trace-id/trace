"""Django adapter. Needs Django installed; importing this module is the only thing that does.

    from trace_device.django import trace_guard

    @trace_guard(reject=lambda e: e["suspectScore"] >= 80)
    def signup(request):
        visitor = request.trace["visitorId"]  # request.trace is None only with fail_open or required=False
"""

import functools
from typing import Any, Callable

from .guard import Guard, parse_json

__all__ = ["trace_guard"]


def trace_guard(guard: Any = None, **options: Any) -> Callable:
    """View decorator. Pass a :class:`Guard`, or its keyword options. Sets `request.trace` to the verified event."""
    from django.http import JsonResponse

    g = guard if isinstance(guard, Guard) else Guard(**options)

    def decorator(view: Callable) -> Callable:
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            content_type = request.content_type or ""
            event_id = g.event_id(request.headers, None) or (
                g.event_id(None, parse_json(request.body))
                if "json" in content_type
                else g.event_id(None, request.POST)  # form posts (urlencoded or multipart)
            )
            outcome = g.check(event_id)
            if not outcome.ok:
                return JsonResponse(outcome.body(), status=outcome.status)
            request.trace = outcome.event
            return view(request, *args, **kwargs)

        return wrapped

    return decorator

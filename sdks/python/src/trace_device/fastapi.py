"""FastAPI (Starlette) adapter. Needs FastAPI installed.

    from fastapi import Depends
    from trace_device.fastapi import trace_dependency

    @app.post("/signup")
    async def signup(event=Depends(trace_dependency(reject=lambda e: e["suspectScore"] >= 80))):
        visitor = event["visitorId"]  # event is None only with fail_open or required=False

The check is a blocking HTTP call, so it runs in a worker thread and never stalls the event loop.
"""

import asyncio
from typing import Any, Callable

from .guard import Guard, parse_json

__all__ = ["trace_dependency"]


def trace_dependency(guard: Any = None, **options: Any) -> Callable:
    """Returns a dependency that yields the verified event, or raises HTTPException with the guard's status."""
    from fastapi import HTTPException, Request

    g = guard if isinstance(guard, Guard) else Guard(**options)

    async def dependency(request: Request):
        event_id = g.event_id(request.headers, None)
        if not event_id and "json" in request.headers.get("content-type", ""):
            event_id = g.event_id(None, parse_json(await request.body()))
        outcome = await asyncio.to_thread(g.check, event_id)
        if not outcome.ok:
            raise HTTPException(status_code=outcome.status, detail=outcome.body()["error"])
        return outcome.event

    return dependency

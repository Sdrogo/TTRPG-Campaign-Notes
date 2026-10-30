"""The Room stream (spec 52): Server-Sent Events telling an open tab that
something it may see changed (Session 0, a map, a Document, its Comments),
never what. The client then re-reads with `GET`."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api.access import require_membership
from app.auth.dependencies import authenticated_user
from app.db import session as session_module
from app.i18n.dependencies import LocaleDep
from app.realtime.broker import Event, broker

router = APIRouter(prefix="/rooms/{room_id}", tags=["events"])

# A comment line this often keeps proxies (Caddy, Render) from closing an
# idle stream (spec 46_2).
KEEPALIVE_S = 25.0

_bearer = HTTPBearer(auto_error=False)


def _sse(event: Event) -> str:
    payload = {"topic": event.topic, "revision": event.revision, "kind": event.kind, "id": event.id}
    return f"data: {json.dumps(payload, default=str)}\n\n"


async def _stream(
    room_id: uuid.UUID, user_id: uuid.UUID, topics: frozenset[str] | None
) -> AsyncIterator[str]:
    """The stream's lines until it is closed (`None`): the member left, the
    Room is gone, or they fell too far behind. Subscribes only once the
    response starts streaming, in the same `try` that forgets the stream
    however it ends, the client hanging up included."""
    subscription = broker.subscribe(room_id, user_id, topics)
    try:
        yield ": open\n\n"
        while True:
            try:
                event = await asyncio.wait_for(subscription.queue.get(), KEEPALIVE_S)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                return
            yield _sse(event)
    finally:
        broker.unsubscribe(subscription)


async def open_room_stream(
    room_id: uuid.UUID,
    credentials: HTTPAuthorizationCredentials | None,
    locale: str,
    topics: frozenset[str] | None = None,
) -> StreamingResponse:
    """Membership is checked once, on a session closed before the stream
    starts, so an open stream holds no database connection. A "View as"
    header is ignored: the stream is the caller's. The token is checked when
    the stream opens only: an open stream outlives its expiry, which is
    harmless since it carries no content, and the client's next `GET` needs
    a fresh token anyway."""
    user_id = uuid.UUID(authenticated_user(credentials, locale).id)
    async with session_module.independent_session() as session:
        await require_membership(session, room_id, user_id, locale)
    return StreamingResponse(
        _stream(room_id, user_id, topics),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/events")
async def room_events(
    room_id: uuid.UUID,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    locale: LocaleDep,
) -> StreamingResponse:
    """Spec 52 Decisions 1-4: one stream per tab inside a Room, one line per
    write the caller may hear of, `{"topic", "revision", "kind", "id"}` and
    never any content. Each event reaches only the members who may know its
    object exists (`app/realtime/audience.py`)."""
    return await open_room_stream(room_id, credentials, locale)

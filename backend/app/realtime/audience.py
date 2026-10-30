"""Who hears of a write on the Room stream (spec 52 Decision 4).

An event names a map or a Document, so it goes only to the members who may
know that object exists: those who see it before or after the write, so
whoever just lost access also re-reads and sees it go. Computed inside the
request's transaction, sent once it has committed."""

import uuid
from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import documents_repo, rooms_repo
from app.db import session as session_module
from app.domain.models import Document
from app.domain.relationship_maps import RelationshipMap, is_map_visible
from app.domain.visibility import is_document_visible
from app.realtime.broker import DOCUMENT, MAP, Event, broker

CHANGED = "changed"
DELETED = "deleted"


def push(
    session: AsyncSession,
    room_id: uuid.UUID,
    event: Event,
    user_ids: Collection[uuid.UUID] | None = None,
) -> None:
    """Sends `event` once the write has committed: to the whole Room, or to
    `user_ids`' streams only. Nothing is sent to nobody."""
    if user_ids is not None and not user_ids:
        return
    audience = None if user_ids is None else frozenset(user_ids)

    async def send(_: AsyncSession) -> None:
        broker.publish(room_id, event, user_ids=audience)

    session_module.on_commit(session, send)


async def map_audience(
    session: AsyncSession, relationship_map: RelationshipMap, grants: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """The members who see `relationship_map` with these Selective grants."""
    members = await rooms_repo.list_memberships(session, relationship_map.room_id)
    return {
        member.user_id
        for member in members
        if is_map_visible(relationship_map, member.user_id, member.role, grants)
    }


async def push_map(
    session: AsyncSession,
    relationship_map: RelationshipMap,
    grants: Collection[uuid.UUID],
    *,
    before: Collection[uuid.UUID] = (),
    kind: str = CHANGED,
) -> None:
    """Tells who sees `relationship_map` (as it now is, with `grants`), and
    `before`, that it changed or was deleted, at its current revision."""
    after = await map_audience(session, relationship_map, grants)
    push(
        session,
        relationship_map.room_id,
        Event(relationship_map.revision, kind, relationship_map.id, MAP),
        after | set(before),
    )


async def document_audience(session: AsyncSession, document: Document) -> set[uuid.UUID]:
    """The members who see `document` as it now is (its level, Owners and
    Selective grants read again)."""
    members = await rooms_repo.list_memberships(session, document.room_id)
    owners = (await documents_repo.list_owner_ids_for_documents(session, [document.id]))[
        document.id
    ]
    grants = (await documents_repo.list_selective_grant_ids_for_documents(session, [document.id]))[
        document.id
    ]
    return {
        member.user_id
        for member in members
        if is_document_visible(document, member.user_id, member.role, owners, grants)
    }


async def push_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    *,
    before: Collection[uuid.UUID] = (),
) -> None:
    """Tells who sees the Document after the write, and `before`, that it
    changed; once it is gone, `before` alone hears it was deleted."""
    document = await documents_repo.get_document(session, document_id)
    if document is None:
        push(session, room_id, Event(None, DELETED, document_id, DOCUMENT), before)
        return
    after = await document_audience(session, document)
    push(session, room_id, Event(None, CHANGED, document_id, DOCUMENT), after | set(before))

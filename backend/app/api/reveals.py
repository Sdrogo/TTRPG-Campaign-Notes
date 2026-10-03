"""Reveals (FR-V2, VR-06, UC-13, spec 22): what the routes revealing a
Document, a Note or a Comment share, and the caller's unseen Reveals for the
header badge. The Reveal routes themselves live with their resource
(`documents`, `notes`, `comments`)."""

import uuid
from collections import defaultdict
from collections.abc import Collection
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import ensure_room_members, lookup_content
from app.api.errors import translated_error
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import reveals_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import ContentKind, Membership, Reveal
from app.domain.reveal import (
    OnlyMasterRevealsError,
    RevealAudience,
    RevealPlan,
    content_id,
    ensure_can_reveal,
    unseen_reveals_once,
)

router = APIRouter(prefix="/reveals", tags=["reveals"])


class RevealRequest(BaseModel):
    """Who to reveal to (spec 22 Decision 1): the whole Room, or these members
    added to the current audience."""

    to_room: bool = False
    user_ids: UniqueIds = []


class RevealDocumentRequest(RevealRequest):
    """A Document's Reveal, with the Notes revealed in the same step to the
    same audience (spec 22 Decision 2). Its Comments are never carried
    along."""

    note_ids: UniqueIds = []


class RevealResponse(BaseModel):
    """A Reveal the caller hasn't opened yet: what was revealed, where and
    when. `document_id` is the Document the content is or is on."""

    id: uuid.UUID
    room_id: uuid.UUID
    kind: ContentKind
    document_id: uuid.UUID
    note_id: uuid.UUID | None
    comment_id: uuid.UUID | None
    revealed_at: datetime


class RevealedInDocument(BaseModel):
    """What opening a Document marked seen (spec 22 Decision 3): the
    Document itself, and which of its Notes and Comments, among those the
    caller sees. The page marks them "Revealed" for this visit."""

    document: bool
    note_ids: list[uuid.UUID]
    comment_ids: list[uuid.UUID]


def audience_of(body: RevealRequest) -> RevealAudience:
    """The domain's view of the requested audience."""
    return RevealAudience(to_room=body.to_room, user_ids=frozenset(body.user_ids))


def ensure_master(membership: Membership, locale: str) -> None:
    """403 unless the requester is the Master (spec 22 Decision 1)."""
    try:
        ensure_can_reveal(membership.role)
    except OnlyMasterRevealsError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc


async def ensure_audience_members(
    session: AsyncSession, room_id: uuid.UUID, body: RevealRequest, locale: str
) -> None:
    """422 unless every chosen member belongs to the Room."""
    await ensure_room_members(session, room_id, body.user_ids, "errors.reveal.invalidUsers", locale)


def reveal_error(exc: DomainError, locale: str) -> HTTPException:
    """The 422 for an empty audience or one that widens nothing."""
    return translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale)


async def record_reveal(session: AsyncSession, plan: RevealPlan) -> None:
    """Writes the Reveal, its recipients and its AuditLog row, in the same
    transaction as the visibility change the caller writes (VR-06,
    Invariant 7)."""
    await reveals_repo.insert_reveal(session, plan.reveal, plan.recipients)
    await rooms_repo.insert_audit_log(session, plan.audit_entry)


async def visible_reveals(
    session: AsyncSession, reveals: Collection[Reveal], viewer: Membership
) -> list[Reveal]:
    """The Reveals of the viewer's Room whose content they still see now
    (Invariant 1): content hidden again since doesn't count (spec 22)."""
    in_room = [reveal for reveal in reveals if reveal.room_id == viewer.room_id]
    lookup = await lookup_content(
        session,
        viewer,
        [r.document_id for r in in_room if r.kind == ContentKind.DOCUMENT],
        [r.note_id for r in in_room if r.note_id is not None],
        [r.comment_id for r in in_room if r.comment_id is not None],
    )
    return [reveal for reveal in in_room if content_id(reveal) in lookup.visible_ids]


async def mark_document_reveals_seen(
    session: AsyncSession, viewer: Membership, document_id: uuid.UUID, now: datetime
) -> RevealedInDocument:
    """Opening a Document opens every Reveal about it, its Notes and its
    Comments (spec 22 Decision 3); returns those the viewer sees."""
    seen = await reveals_repo.mark_seen_in_document(session, viewer.user_id, document_id, now)
    visible = await visible_reveals(session, seen, viewer)
    return RevealedInDocument(
        document=any(r.kind == ContentKind.DOCUMENT for r in visible),
        note_ids=sorted({r.note_id for r in visible if r.note_id is not None}),
        comment_ids=sorted({r.comment_id for r in visible if r.comment_id is not None}),
    )


def reveal_response(reveal: Reveal) -> RevealResponse:
    """Serializes a Reveal for its recipient."""
    return RevealResponse(
        id=reveal.id,
        room_id=reveal.room_id,
        kind=reveal.kind,
        document_id=reveal.document_id,
        note_id=reveal.note_id,
        comment_id=reveal.comment_id,
        revealed_at=reveal.revealed_at,
    )


@router.get("/mine")
async def list_my_reveals(
    current_user: CurrentUserDep, session: SessionDep
) -> list[RevealResponse]:
    """The content revealed to the caller that they haven't opened yet, in
    every Room they are still in, newest first: the "Revealed" marks and the
    header badge (spec 22 Decision 3). Only content they still see counts
    (VR-07), and content revealed to them twice counts once."""
    user_id = uuid.UUID(current_user.id)
    unseen = await reveals_repo.list_unseen_reveals(session, user_id)
    by_room: dict[uuid.UUID, list[Reveal]] = defaultdict(list)
    for reveal in unseen:
        by_room[reveal.room_id].append(reveal)

    visible: list[Reveal] = []
    for room_id, reveals in by_room.items():
        membership = await rooms_repo.get_membership(session, room_id, user_id)
        if membership is not None:
            visible.extend(await visible_reveals(session, reveals, membership))
    return [reveal_response(reveal) for reveal in unseen_reveals_once(visible)]

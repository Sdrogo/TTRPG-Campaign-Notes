"""A Room's Tags (D-14, FR-N1): the labels Documents are classified and
filtered by, in place of rigid Document types (D-05)."""

import uuid

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.api.errors import http_error
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo, tags_repo
from app.db.session import SessionDep
from app.domain.models import RoomRole, Tag
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/tags", tags=["tags"])


class TagResponse(BaseModel):
    """A Tag with its optional category (e.g. "Type", "Faction")."""

    id: uuid.UUID
    name: str
    category: str | None


class CreateTagRequest(BaseModel):
    """A new Tag. The name is trimmed and must be unique within the Room."""

    name: str
    category: str | None = None


@router.get("")
async def list_tags(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[TagResponse]:
    """Every Tag in the Room, for any member."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)

    tags = await tags_repo.list_tags(session, room_id)
    return [TagResponse(id=t.id, name=t.name, category=t.category) for t in tags]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_tag(
    room_id: uuid.UUID,
    body: CreateTagRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> TagResponse:
    """Adds a Tag. Only an Administrator or the Master may manage Tags; 409
    when the Room already has one with that name."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None or not (membership.is_admin or membership.role == RoomRole.MASTER):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.tag.notAllowedToManage", locale)

    name = body.name.strip()
    if not name:
        raise http_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.tag.nameRequired", locale)

    tag = Tag(id=uuid.uuid4(), room_id=room_id, name=name, category=body.category)
    try:
        # A SAVEPOINT (not the whole request transaction) absorbs the
        # failure, so a duplicate name doesn't poison later statements in
        # this same request/transaction (see app/db/session.py).
        async with session.begin_nested():
            await tags_repo.insert_tag(session, tag)
    except IntegrityError as exc:
        raise http_error(status.HTTP_409_CONFLICT, "errors.tag.duplicateName", locale) from exc

    return TagResponse(id=tag.id, name=tag.name, category=tag.category)

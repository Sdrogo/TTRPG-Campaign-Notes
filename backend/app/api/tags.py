"""A Room's Tags (D-14, FR-N1): the labels Documents are classified and
filtered by, in place of rigid Document types (D-05)."""

import uuid
from dataclasses import replace

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.api.errors import http_error, translated_error
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo, tags_repo
from app.db.session import SessionDep
from app.domain.models import RoomRole, Tag
from app.domain.tags import DuplicateMainTagError, UnknownMainTagError, plan_main_tags
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/tags", tags=["tags"])


class TagResponse(BaseModel):
    """A Tag with its optional category (e.g. "Type", "Faction")."""

    id: uuid.UUID
    name: str
    category: str | None
    main_position: int | None


class SetMainTagsRequest(BaseModel):
    """The Room's Main Tags, in the order Documents are grouped by them."""

    tag_ids: list[uuid.UUID]


def tag_to_response(tag: Tag) -> TagResponse:
    """Serializes a Tag the same way for every route that returns one."""
    return TagResponse(
        id=tag.id, name=tag.name, category=tag.category, main_position=tag.main_position
    )


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
    return [tag_to_response(t) for t in tags]


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

    return tag_to_response(tag)


@router.put("/main")
async def set_main_tags(
    room_id: uuid.UUID,
    body: SetMainTagsRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[TagResponse]:
    """Spec 11: an Administrator chooses which Tags are the Room's Main Tags
    and their order (the Documents list groups by them in that order). The
    list replaces the previous selection; an empty one clears it. 422 for a
    repeated Tag or one that isn't in this Room. Returns every Tag of the
    Room."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None or not membership.is_admin:
        raise http_error(
            status.HTTP_403_FORBIDDEN, "errors.tag.onlyAdministratorCanSetMainTags", locale
        )

    tags = await tags_repo.list_tags(session, room_id)
    try:
        positions = plan_main_tags([t.id for t in tags], body.tag_ids)
    except (DuplicateMainTagError, UnknownMainTagError) as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await tags_repo.set_main_positions(session, room_id, positions)
    return [tag_to_response(replace(t, main_position=positions[t.id])) for t in tags]

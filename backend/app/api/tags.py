"""A Room's Tags (D-14, FR-N1): the labels Documents are classified and
filtered by, in place of rigid Document types (D-05)."""

import dataclasses
import uuid

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.api.errors import http_error
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo, tags_repo
from app.db.session import SessionDep
from app.domain.models import RoomRole, Tag
from app.domain.tags import plan_tag_removal
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/tags", tags=["tags"])


class TagResponse(BaseModel):
    """A Tag with its optional category (e.g. "Type", "Faction")."""

    id: uuid.UUID
    name: str
    category: str | None
    main_position: int | None


def tag_to_response(tag: Tag) -> TagResponse:
    """Serializes a Tag the same way for every route that returns one."""
    return TagResponse(
        id=tag.id, name=tag.name, category=tag.category, main_position=tag.main_position
    )


class CreateTagRequest(BaseModel):
    """A new Tag. The name is trimmed and must be unique within the Room."""

    name: str
    category: str | None = None


class RenameTagRequest(BaseModel):
    """A Tag's new name, trimmed; unique within the Room like a new Tag's."""

    name: str


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


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    room_id: uuid.UUID,
    tag_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """Spec 13: an Administrator or the Master (who may also create Tags)
    deletes a Tag. Documents keep everything but the link to it; its single
    Main item goes, and combinations that held it shrink or, below two Tags,
    disappear (`plan_tag_removal`). 404 for a Tag that isn't in this Room."""
    membership = await rooms_repo.get_membership(session, room_id, uuid.UUID(current_user.id))
    if membership is None or not (membership.is_admin or membership.role == RoomRole.MASTER):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.tag.notAllowedToManage", locale)

    # Same lock as saving the Main items, so the two can't interleave.
    await rooms_repo.lock_room(session, room_id)
    if not await tags_repo.get_tags_by_ids(session, room_id, [tag_id]):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.tag.notFound", locale)

    combinations = await tags_repo.list_combinations(session, room_id)
    await tags_repo.delete_tag(session, room_id, tag_id)
    await tags_repo.replace_combinations(session, room_id, plan_tag_removal(tag_id, combinations))


@router.patch("/{tag_id}")
async def rename_tag(
    room_id: uuid.UUID,
    tag_id: uuid.UUID,
    body: RenameTagRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> TagResponse:
    """Spec 25c: an Administrator or the Master (who may create and delete
    Tags) renames a Tag; the category stays. Documents, Main items,
    combinations, `?tag=` filters and mention tokens refer to it by id, so
    they show the new name at once. 403 for anyone else, 404 for a Tag that
    isn't in this Room, 422 for a blank name, 409 for a name another Tag of
    the Room has. Renaming to the current name changes nothing."""
    membership = await rooms_repo.get_membership(session, room_id, uuid.UUID(current_user.id))
    if membership is None or not (membership.is_admin or membership.role == RoomRole.MASTER):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.tag.notAllowedToManage", locale)

    found = await tags_repo.get_tags_by_ids(session, room_id, [tag_id])
    if not found:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.tag.notFound", locale)
    tag = found[0]

    name = body.name.strip()
    if not name:
        raise http_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.tag.nameRequired", locale)
    if name == tag.name:
        return tag_to_response(tag)

    try:
        # A SAVEPOINT, as in `create_tag`, so a duplicate name leaves the
        # request's transaction usable.
        async with session.begin_nested():
            await tags_repo.rename_tag(session, room_id, tag_id, name)
    except IntegrityError as exc:
        raise http_error(status.HTTP_409_CONFLICT, "errors.tag.duplicateName", locale) from exc

    return tag_to_response(dataclasses.replace(tag, name=name))

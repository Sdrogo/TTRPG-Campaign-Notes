"""A Room's Main items (specs 11 and 11_2): the line items - a single Tag or a
combination of two or more - its Documents list groups by, in order."""

import uuid

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import http_error, translated_error
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo, tags_repo
from app.db.session import SessionDep
from app.domain.tags import (
    DuplicateCombinationError,
    DuplicateMainTagError,
    EmptyMainItemError,
    UnknownMainTagError,
    ordered_main_items,
    plan_main_items,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/tags/main", tags=["tags"])


class MainItem(BaseModel):
    """One line item: one Tag, or two or more whose shared Documents form a
    group."""

    tag_ids: list[uuid.UUID]


class SetMainItemsRequest(BaseModel):
    """The Room's Main items, in the order Documents are grouped by them."""

    items: list[MainItem]


async def _read_items(session: AsyncSession, room_id: uuid.UUID) -> list[MainItem]:
    """The Room's Main items in order, singles and combinations merged."""
    tags = await tags_repo.list_tags(session, room_id)
    combinations = await tags_repo.list_combinations(session, room_id)
    return [MainItem(tag_ids=list(ids)) for ids in ordered_main_items(tags, combinations)]


@router.get("")
async def list_main_items(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[MainItem]:
    """The Room's Main items in their chosen order, for any member - the
    Documents list needs them to group."""
    membership = await rooms_repo.get_membership(session, room_id, uuid.UUID(current_user.id))
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)
    return await _read_items(session, room_id)


@router.put("")
async def set_main_items(
    room_id: uuid.UUID,
    body: SetMainItemsRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[MainItem]:
    """An Administrator chooses the Room's Main items and their order. An item
    with one Tag is a Main Tag (spec 11), with two or more a combination (spec
    11_2). The list replaces the previous selection; an empty one clears it.
    422 for an empty item, a repeated Tag or combination, or a Tag that isn't
    in this Room. Returns the saved items."""
    membership = await rooms_repo.get_membership(session, room_id, uuid.UUID(current_user.id))
    if membership is None or not membership.is_admin:
        raise http_error(
            status.HTTP_403_FORBIDDEN, "errors.tag.onlyAdministratorCanSetMainTags", locale
        )

    tags = await tags_repo.list_tags(session, room_id)
    try:
        plan = plan_main_items([t.id for t in tags], [item.tag_ids for item in body.items])
    except (
        EmptyMainItemError,
        DuplicateMainTagError,
        DuplicateCombinationError,
        UnknownMainTagError,
    ) as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await tags_repo.set_main_positions(session, room_id, plan.tag_positions)
    await tags_repo.replace_combinations(session, room_id, plan.combinations)
    return await _read_items(session, room_id)

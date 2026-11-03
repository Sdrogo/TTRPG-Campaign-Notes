"""Groups of clocks (spec 61 Decisions 11-12): free, race, turn and sequence
groups of a Room's clocks, arranged by the Master. A member sees a group
only through the clocks of it they see: one holding none of them is left
out, and a group's clocks and result name only those (Decision 15)."""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.clocks import (
    ClockResponse,
    clock_responses,
    record_state_change,
    visible_clocks,
)
from app.api.errors import http_error, translated_error
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import clocks_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.clocks import (
    MAX_CLOCKS_PER_GROUP,
    MAX_DECISIVE_LABEL_LENGTH,
    MAX_GROUPS_PER_ROOM,
    Clock,
    ClockEvent,
    ClockFieldError,
    ClockGroup,
    ClockLimitError,
    ClockState,
    GroupMode,
    GroupNotEndableError,
    HistoryAction,
    clean_line,
    clean_name,
    end_group,
    ensure_below,
    group_order,
    pending_ids,
    visible_result,
)
from app.domain.errors import DomainError
from app.domain.models import Membership, RoomRole
from app.i18n.dependencies import LocaleDep
from app.realtime.audience import CHANGED, DELETED, clock_audience, push, push_clock
from app.realtime.broker import CLOCK_GROUP, Event

router = APIRouter(prefix="/rooms/{room_id}", tags=["clocks"])


class GroupResponse(BaseModel):
    """A group as the requester sees it: its clocks in order (only those they
    see), the result of an ended race or turn, and `pending_ids`, the closed
    clocks waiting for the Master's confirmation (a race's winner or tie, a
    turn's decisive clocks)."""

    id: uuid.UUID
    name: str
    mode: GroupMode
    position: int
    clock_ids: list[uuid.UUID]
    ended: bool
    result: dict[str, object] | None
    pending_ids: list[uuid.UUID]
    revision: int


class CreateGroupRequest(BaseModel):
    """A new, empty group."""

    name: str
    mode: GroupMode = GroupMode.FREE


class UpdateGroupRequest(BaseModel):
    """A group's new name or mode; `archived` archives or restores all its
    clocks (Decision 12)."""

    name: str | None = None
    mode: GroupMode | None = None
    archived: bool | None = None


class GroupItem(BaseModel):
    """A clock of a group, with a turn's outcome label when it is decisive."""

    clock_id: uuid.UUID
    decisive_label: str | None = None


class GroupClocksRequest(BaseModel):
    """The group's clocks, in order (it holds exactly these afterwards)."""

    items: list[GroupItem] = Field(max_length=100)


class OrderRequest(BaseModel):
    """Every group of the Room, once, in the new order."""

    ids: UniqueIds


class GroupEndResponse(BaseModel):
    """An ended group and its clocks as the Master now sees them."""

    group: GroupResponse
    clocks: list[ClockResponse]


def _now() -> datetime:
    """The current time, in UTC."""
    return datetime.now(UTC)


def _fail(exc: DomainError, locale: str) -> Exception:
    """The HTTP error for a group rule broken."""
    codes = {
        ClockFieldError: status.HTTP_422_UNPROCESSABLE_CONTENT,
        ClockLimitError: status.HTTP_409_CONFLICT,
        GroupNotEndableError: status.HTTP_409_CONFLICT,
    }
    return translated_error(codes[type(exc)], exc, locale)


async def _master(
    session: AsyncSession, room_id: uuid.UUID, user_id: str, locale: str
) -> Membership:
    """The requester's Membership; 403 unless they are the Master (D-08)."""
    membership = await require_membership(session, room_id, uuid.UUID(user_id), locale)
    if membership.role != RoomRole.MASTER:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.clock.onlyMaster", locale)
    return membership


async def _locked_group(
    session: AsyncSession, room_id: uuid.UUID, group_id: uuid.UUID, locale: str
) -> ClockGroup:
    """The Room's group under its lock, or 404."""
    group = await clocks_repo.lock_group(session, group_id)
    if group is None or group.room_id != room_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.groupNotFound", locale)
    return group


def group_response(group: ClockGroup, shown: Sequence[Clock]) -> GroupResponse:
    """A group with only the clocks `shown` to its viewer."""
    members = group_order(clock for clock in shown if clock.group_id == group.id)
    ids = [clock.id for clock in members]
    return GroupResponse(
        id=group.id,
        name=group.name,
        mode=group.mode,
        position=group.position,
        clock_ids=ids,
        ended=group.ended_at is not None,
        result=visible_result(group.result, ids),
        pending_ids=pending_ids(group, members),
        revision=group.revision,
    )


async def _group_audience(
    session: AsyncSession, room_id: uuid.UUID, clocks: Collection[Clock]
) -> set[uuid.UUID]:
    """The members who see one of the group's clocks, and the Masters."""
    members = await rooms_repo.list_memberships(session, room_id)
    heard = {member.user_id for member in members if member.role == RoomRole.MASTER}
    grants = await clocks_repo.list_grants(session, [clock.id for clock in clocks])
    for clock in clocks:
        heard |= await clock_audience(session, clock, grants[clock.id])
    return heard


async def _push_group(
    session: AsyncSession,
    group: ClockGroup,
    clocks: Collection[Clock],
    *,
    kind: str = CHANGED,
    before: Collection[uuid.UUID] = (),
) -> None:
    """Tells who sees the group (through its clocks), and `before`, that it
    changed or was deleted (Decision 22)."""
    heard = await _group_audience(session, group.room_id, clocks)
    push(
        session,
        group.room_id,
        Event(group.revision, kind, group.id, CLOCK_GROUP),
        heard | set(before),
    )


async def _members(session: AsyncSession, room_id: uuid.UUID, group_id: uuid.UUID) -> list[Clock]:
    """The group's clocks, every one of them."""
    return [c for c in await clocks_repo.list_clocks(session, room_id) if c.group_id == group_id]


async def _record(
    session: AsyncSession, clock: Clock, user_id: uuid.UUID, action: HistoryAction
) -> None:
    """A line of a clock's history."""
    await clocks_repo.insert_event(
        session,
        ClockEvent(
            id=uuid.uuid4(),
            clock_id=clock.id,
            user_id=user_id,
            action=action,
            details={},
            created_at=_now(),
        ),
    )


async def _save_clocks(
    session: AsyncSession, changed: Sequence[tuple[Clock, Clock]], user_id: uuid.UUID
) -> list[Clock]:
    """Writes each `(before, after)` clock and tells who sees it."""
    saved = []
    for before, after in changed:
        grants = (await clocks_repo.list_grants(session, [before.id]))[before.id]
        audience = await clock_audience(session, before, grants)
        updated = await clocks_repo.update_clock(session, replace(after, updated_at=_now()))
        await record_state_change(session, before, updated, user_id)
        await push_clock(session, updated, grants, before=audience)
        saved.append(updated)
    return saved


@router.get("/clock-groups")
async def list_groups(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[GroupResponse]:
    """Decision 17: the Room's groups in the Master's order, each with the
    clocks of it the requester sees; a group holding none of them is left
    out (the Master sees every group, empty ones too)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    shown = await visible_clocks(session, room_id, membership)
    groups = await clocks_repo.list_groups(session, room_id)
    is_master = membership.role == RoomRole.MASTER
    return [
        response
        for response in (group_response(group, shown) for group in groups)
        if is_master or response.clock_ids
    ]


@router.post("/clock-groups", status_code=status.HTTP_201_CREATED)
async def create_group(
    room_id: uuid.UUID,
    body: CreateGroupRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GroupResponse:
    """Decision 11: the Master makes an empty group ("Nuovo gruppo", or "Nuova
    svolta" after an ended turn), up to 30 per Room."""
    membership = await _master(session, room_id, current_user.id, locale)
    await rooms_repo.lock_room(session, room_id)
    groups = await clocks_repo.list_groups(session, room_id)
    try:
        name = clean_name(body.name, field_key="groupName")
        ensure_below(len(groups), MAX_GROUPS_PER_ROOM, "errors.clock.tooManyGroups")
    except DomainError as exc:
        raise _fail(exc, locale) from exc
    now = _now()
    group = await clocks_repo.save_group(
        session,
        ClockGroup(
            id=uuid.uuid4(),
            room_id=room_id,
            name=name,
            mode=body.mode,
            position=max((g.position for g in groups), default=-1) + 1,
            created_by=membership.user_id,
            created_at=now,
            updated_at=now,
        ),
    )
    await _push_group(session, group, [])
    return group_response(group, [])


@router.put("/clock-groups-order")
async def reorder_groups(
    room_id: uuid.UUID,
    body: OrderRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[GroupResponse]:
    """The Master orders the groups on the Clocks page: every one, once
    (422)."""
    membership = await _master(session, room_id, current_user.id, locale)
    await rooms_repo.lock_room(session, room_id)
    groups = {group.id: group for group in await clocks_repo.list_groups(session, room_id)}
    if set(body.ids) != set(groups):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.orderMismatch", locale
        )
    clocks = await clocks_repo.list_clocks(session, room_id)
    saved = []
    for position, group_id in enumerate(body.ids):
        group = await clocks_repo.save_group(
            session, replace(groups[group_id], position=position, updated_at=_now())
        )
        await _push_group(session, group, [c for c in clocks if c.group_id == group_id])
        saved.append(group)
    shown = await visible_clocks(session, room_id, membership)
    return [group_response(group, shown) for group in saved]


@router.patch("/clock-groups/{group_id}")
async def update_group(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    body: UpdateGroupRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GroupResponse:
    """The Master renames a group, changes its mode (not once it has ended,
    409), or archives or restores all its clocks (Decision 12)."""
    membership = await _master(session, room_id, current_user.id, locale)
    group = await _locked_group(session, room_id, group_id, locale)
    if body.mode is not None and body.mode != group.mode and group.ended_at is not None:
        raise http_error(status.HTTP_409_CONFLICT, "errors.clock.groupEnded", locale)
    try:
        name = group.name if body.name is None else clean_name(body.name, field_key="groupName")
    except ClockFieldError as exc:
        raise _fail(exc, locale) from exc
    members = await _members(session, room_id, group_id)
    mode = body.mode or group.mode
    now = _now()
    changed = []
    for clock in members:
        after = clock
        if body.archived is not None and (clock.archived_at is None) == body.archived:
            after = replace(after, archived_at=now if body.archived else None)
        if mode != GroupMode.TURN and clock.decisive_label is not None:
            after = replace(after, decisive_label=None)
        if after != clock:
            changed.append((clock, after))
    await _save_clocks(session, changed, membership.user_id)
    for before, after in changed:
        if before.archived_at != after.archived_at:
            action = HistoryAction.ARCHIVED if body.archived else HistoryAction.RESTORED
            await _record(session, after, membership.user_id, action)
    members = await _members(session, room_id, group_id)
    updated = await clocks_repo.save_group(
        session, replace(group, name=name, mode=mode, updated_at=now)
    )
    await _push_group(session, updated, members)
    shown = await visible_clocks(session, room_id, membership)
    return group_response(updated, shown)


@router.put("/clock-groups/{group_id}/clocks")
async def set_group_clocks(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    body: GroupClocksRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GroupResponse:
    """Decision 11: the Master puts these clocks in the group, in order (a
    clock in another group moves here: a clock is in one group at most), up
    to 12; the clocks left out leave it. A decisive label is kept only in a
    turn group. 422 for a clock of another Room or named twice."""
    membership = await _master(session, room_id, current_user.id, locale)
    group = await _locked_group(session, room_id, group_id, locale)
    ids = [item.clock_id for item in body.items]
    clocks = {clock.id: clock for clock in await clocks_repo.list_clocks(session, room_id)}
    if len(set(ids)) != len(ids) or not set(ids) <= set(clocks):
        raise http_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.unknownClock", locale)
    try:
        if len(ids) > MAX_CLOCKS_PER_GROUP:
            raise ClockLimitError("errors.clock.tooManyInGroup", max=MAX_CLOCKS_PER_GROUP)
        labels = [
            clean_line(item.decisive_label, MAX_DECISIVE_LABEL_LENGTH, "decisiveLabel")
            if group.mode == GroupMode.TURN
            else None
            for item in body.items
        ]
    except DomainError as exc:
        raise _fail(exc, locale) from exc
    changed: list[tuple[Clock, Clock]] = []
    moved_from: set[uuid.UUID] = set()
    for position, (clock_id, label) in enumerate(zip(ids, labels, strict=True)):
        clock = clocks[clock_id]
        after = replace(clock, group_id=group_id, group_position=position, decisive_label=label)
        if after != clock:
            if clock.group_id not in (None, group_id):
                moved_from.add(clock.group_id)
            changed.append((clock, after))
    for clock in clocks.values():
        if clock.group_id == group_id and clock.id not in ids:
            changed.append(
                (clock, replace(clock, group_id=None, group_position=None, decisive_label=None))
            )
    saved = await _save_clocks(session, changed, membership.user_id)
    after_clocks = {**clocks, **{clock.id: clock for clock in saved}}
    updated = await clocks_repo.save_group(session, replace(group, updated_at=_now()))
    await _push_group(
        session, updated, [c for c in after_clocks.values() if c.group_id == group_id]
    )
    for other_id in moved_from:
        other = await clocks_repo.lock_group(session, other_id)
        other = await clocks_repo.get_group(session, other_id)
        assert other is not None  # its clocks were just read pointing at it
        other = await clocks_repo.save_group(session, replace(other, updated_at=_now()))
        await _push_group(
            session, other, [c for c in after_clocks.values() if c.group_id == other_id]
        )
    shown = await visible_clocks(session, room_id, membership)
    return group_response(updated, shown)


@router.post("/clock-groups/{group_id}/end")
async def confirm_group_end(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GroupEndResponse:
    """Decision 11: the Master confirms a race ("Conferma": won, or a tie
    when more than one clock closed) or ends a turn ("Termina la svolta":
    its open clocks lapse). 409 when there is nothing to confirm."""
    membership = await _master(session, room_id, current_user.id, locale)
    group = await _locked_group(session, room_id, group_id, locale)
    members = await _members(session, room_id, group_id)
    try:
        ended = end_group(group, members)
    except GroupNotEndableError as exc:
        raise _fail(exc, locale) from exc
    lapsing = [
        (clock, replace(clock, state=ClockState.LAPSED))
        for clock in members
        if clock.id in ended.lapsed_ids
    ]
    saved = await _save_clocks(session, lapsing, membership.user_id)
    for clock in saved:
        await _record(session, clock, membership.user_id, HistoryAction.LAPSED)
    now = _now()
    updated = await clocks_repo.save_group(
        session, replace(group, ended_at=now, result=ended.result, updated_at=now)
    )
    by_id = {clock.id: clock for clock in [*members, *saved]}
    await _push_group(session, updated, list(by_id.values()))
    shown = await visible_clocks(session, room_id, membership)
    in_group = [clock for clock in shown if clock.group_id == group_id]
    return GroupEndResponse(
        group=group_response(updated, shown),
        clocks=await clock_responses(session, room_id, in_group, membership),
    )


@router.delete("/clock-groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """The Master deletes a group; its clocks stay, outside any group."""
    membership = await _master(session, room_id, current_user.id, locale)
    group = await _locked_group(session, room_id, group_id, locale)
    members = await _members(session, room_id, group_id)
    await _push_group(session, group, members, kind=DELETED)
    await _save_clocks(
        session,
        [
            (clock, replace(clock, group_id=None, group_position=None, decisive_label=None))
            for clock in members
        ],
        membership.user_id,
    )
    await clocks_repo.delete_group(session, group_id)

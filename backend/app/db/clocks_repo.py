"""Clocks (spec 61): the Room's clock rules, labels, mark kinds, templates,
clocks with their grants, labels, marks and history, and groups. Nothing
here filters for a viewer: the routes do, through `app.domain.clocks`."""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    RoomClockEventRow,
    RoomClockGrantRow,
    RoomClockGroupRow,
    RoomClockLabelLinkRow,
    RoomClockLabelRow,
    RoomClockMarkKindRow,
    RoomClockMarkRow,
    RoomClockRow,
    RoomClockRulesRow,
    RoomClockTemplateRow,
)
from app.domain.clocks import (
    Clock,
    ClockEvent,
    ClockGroup,
    ClockLabel,
    ClockMark,
    ClockRules,
    ClockState,
    ClockTemplate,
    GroupMode,
    HistoryAction,
    KindWho,
    MarkKind,
    MarkPolicy,
    OpenPolicy,
    settings_from_json,
    settings_to_json,
)
from app.domain.models import DocumentVisibility
from app.domain.relationship_maps import MapColor

# --- Rules --------------------------------------------------------------------


async def get_rules(session: AsyncSession, room_id: uuid.UUID) -> ClockRules:
    """The Room's clock rules, the defaults when none were saved."""
    row = await session.get(RoomClockRulesRow, room_id)
    if row is None:
        return ClockRules(room_id=room_id)
    return ClockRules(
        room_id=room_id,
        open_policy=OpenPolicy(row.open_policy),
        mark_policy=MarkPolicy(row.mark_policy),
        allow_unmark=row.allow_unmark,
    )


async def save_rules(session: AsyncSession, rules: ClockRules, now: datetime) -> None:
    """Writes the Room's clock rules."""
    row = await session.get(RoomClockRulesRow, rules.room_id)
    if row is None:
        row = RoomClockRulesRow(room_id=rules.room_id)
        session.add(row)
    row.open_policy = rules.open_policy.value
    row.mark_policy = rules.mark_policy.value
    row.allow_unmark = rules.allow_unmark
    row.updated_at = now
    await session.flush()


# --- Labels -------------------------------------------------------------------


def _label_from_row(row: RoomClockLabelRow) -> ClockLabel:
    """Maps a label row."""
    return ClockLabel(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        color=MapColor(row.color),
        position=row.position,
    )


async def list_labels(session: AsyncSession, room_id: uuid.UUID) -> list[ClockLabel]:
    """The Room's labels in their order."""
    result = await session.execute(
        select(RoomClockLabelRow)
        .where(RoomClockLabelRow.room_id == room_id)
        .order_by(RoomClockLabelRow.position, RoomClockLabelRow.name)
    )
    return [_label_from_row(row) for row in result.scalars()]


async def save_label(session: AsyncSession, label: ClockLabel) -> None:
    """Inserts or rewrites a label."""
    row = await session.get(RoomClockLabelRow, label.id)
    if row is None:
        row = RoomClockLabelRow(id=label.id, room_id=label.room_id)
        session.add(row)
    row.name = label.name
    row.color = label.color.value
    row.position = label.position
    await session.flush()


async def delete_label(session: AsyncSession, label_id: uuid.UUID) -> None:
    """Deletes a label; its clocks lose it."""
    await session.execute(delete(RoomClockLabelRow).where(RoomClockLabelRow.id == label_id))


async def count_label_uses(session: AsyncSession, room_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """How many clocks carry each of the Room's labels (none: absent)."""
    rows = await session.execute(
        select(RoomClockLabelLinkRow.label_id, func.count())
        .join(RoomClockLabelRow, RoomClockLabelRow.id == RoomClockLabelLinkRow.label_id)
        .where(RoomClockLabelRow.room_id == room_id)
        .group_by(RoomClockLabelLinkRow.label_id)
    )
    return {label_id: int(count) for label_id, count in rows}


# --- Mark kinds ---------------------------------------------------------------


def _kind_from_row(row: RoomClockMarkKindRow) -> MarkKind:
    """Maps a mark kind row."""
    return MarkKind(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        color=MapColor(row.color),
        who=KindWho(row.who),
        position=row.position,
    )


async def list_kinds(session: AsyncSession, room_id: uuid.UUID) -> list[MarkKind]:
    """The Room's mark kinds in their order."""
    result = await session.execute(
        select(RoomClockMarkKindRow)
        .where(RoomClockMarkKindRow.room_id == room_id)
        .order_by(RoomClockMarkKindRow.position, RoomClockMarkKindRow.name)
    )
    return [_kind_from_row(row) for row in result.scalars()]


async def save_kind(session: AsyncSession, kind: MarkKind) -> None:
    """Inserts or rewrites a mark kind."""
    row = await session.get(RoomClockMarkKindRow, kind.id)
    if row is None:
        row = RoomClockMarkKindRow(id=kind.id, room_id=kind.room_id)
        session.add(row)
    row.name = kind.name
    row.color = kind.color.value
    row.who = kind.who.value
    row.position = kind.position
    await session.flush()


async def delete_kind(session: AsyncSession, kind_id: uuid.UUID) -> None:
    """Deletes a mark kind; its past marks keep no kind (neutral grey)."""
    await session.execute(delete(RoomClockMarkKindRow).where(RoomClockMarkKindRow.id == kind_id))


# --- Templates ----------------------------------------------------------------


def _template_from_row(row: RoomClockTemplateRow) -> ClockTemplate:
    """Maps a template row."""
    return ClockTemplate(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        settings=settings_from_json(row.settings),
        position=row.position,
        created_at=row.created_at,
    )


async def list_templates(session: AsyncSession, room_id: uuid.UUID) -> list[ClockTemplate]:
    """The Room's templates in their order."""
    result = await session.execute(
        select(RoomClockTemplateRow)
        .where(RoomClockTemplateRow.room_id == room_id)
        .order_by(RoomClockTemplateRow.position, RoomClockTemplateRow.created_at)
    )
    return [_template_from_row(row) for row in result.scalars()]


async def save_template(session: AsyncSession, template: ClockTemplate) -> None:
    """Inserts or rewrites a template."""
    row = await session.get(RoomClockTemplateRow, template.id)
    if row is None:
        row = RoomClockTemplateRow(
            id=template.id, room_id=template.room_id, created_at=template.created_at
        )
        session.add(row)
    row.name = template.name
    row.settings = settings_to_json(template.settings)
    row.position = template.position
    await session.flush()


async def delete_template(session: AsyncSession, template_id: uuid.UUID) -> None:
    """Deletes a template."""
    await session.execute(
        delete(RoomClockTemplateRow).where(RoomClockTemplateRow.id == template_id)
    )


# --- Clocks -------------------------------------------------------------------


def _clock_from_row(row: RoomClockRow, label_ids: Sequence[uuid.UUID]) -> Clock:
    """Maps a clock row and its labels."""
    return Clock(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        description=row.description,
        segments=row.segments,
        filled=row.filled,
        color=MapColor(row.color),
        stage_labels=tuple(row.stage_labels),
        closing_condition=row.closing_condition,
        consequence=row.consequence,
        forward_only=row.forward_only,
        mark_policy=None if row.mark_policy is None else MarkPolicy(row.mark_policy),
        state=ClockState(row.state),
        archived_at=row.archived_at,
        group_id=row.group_id,
        group_position=row.group_position,
        decisive_label=row.decisive_label,
        document_id=row.document_id,
        position=row.position,
        visibility=DocumentVisibility(row.visibility),
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
        revision=row.revision,
        label_ids=tuple(label_ids),
    )


async def _label_ids_for(
    session: AsyncSession, clock_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Each clock's labels in its order, in one query."""
    found: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if clock_ids:
        rows = await session.execute(
            select(RoomClockLabelLinkRow.clock_id, RoomClockLabelLinkRow.label_id)
            .where(RoomClockLabelLinkRow.clock_id.in_(clock_ids))
            .order_by(RoomClockLabelLinkRow.position)
        )
        for clock_id, label_id in rows:
            found[clock_id].append(label_id)
    return found


async def _clocks_from_rows(session: AsyncSession, rows: Sequence[RoomClockRow]) -> list[Clock]:
    """Maps clock rows with their labels."""
    labels = await _label_ids_for(session, [row.id for row in rows])
    return [_clock_from_row(row, labels[row.id]) for row in rows]


def _write_clock(row: RoomClockRow, clock: Clock) -> None:
    """Copies every stored field of `clock` onto its row."""
    row.name = clock.name
    row.description = clock.description
    row.segments = clock.segments
    row.filled = clock.filled
    row.color = clock.color.value
    row.stage_labels = list(clock.stage_labels)
    row.closing_condition = clock.closing_condition
    row.consequence = clock.consequence
    row.forward_only = clock.forward_only
    row.mark_policy = None if clock.mark_policy is None else clock.mark_policy.value
    row.state = clock.state.value
    row.archived_at = clock.archived_at
    row.group_id = clock.group_id
    row.group_position = clock.group_position
    row.decisive_label = clock.decisive_label
    row.document_id = clock.document_id
    row.position = clock.position
    row.visibility = clock.visibility.value
    row.updated_at = clock.updated_at


async def _set_labels(
    session: AsyncSession, clock_id: uuid.UUID, label_ids: Sequence[uuid.UUID]
) -> None:
    """Replaces a clock's labels."""
    await session.execute(
        delete(RoomClockLabelLinkRow).where(RoomClockLabelLinkRow.clock_id == clock_id)
    )
    session.add_all(
        RoomClockLabelLinkRow(clock_id=clock_id, label_id=label_id, position=position)
        for position, label_id in enumerate(label_ids)
    )
    await session.flush()


async def insert_clock(
    session: AsyncSession, clock: Clock, selective_user_ids: Collection[uuid.UUID]
) -> None:
    """Inserts a new clock, its labels and its Selective grants."""
    row = RoomClockRow(
        id=clock.id, room_id=clock.room_id, created_by=clock.created_by, created_at=clock.created_at
    )
    _write_clock(row, clock)
    session.add(row)
    await session.flush()
    await _set_labels(session, clock.id, clock.label_ids)
    await set_grants(session, clock.id, selective_user_ids)


async def get_clock(session: AsyncSession, clock_id: uuid.UUID) -> Clock | None:
    """The clock, or None. Not yet checked against any viewer."""
    row = await session.get(RoomClockRow, clock_id)
    return (await _clocks_from_rows(session, [row]))[0] if row else None


async def lock_clock(session: AsyncSession, clock_id: uuid.UUID) -> Clock | None:
    """Takes the clock's row lock until the transaction ends and returns it
    as of the lock: marks and edits of one clock serialize on it."""
    result = await session.execute(
        select(RoomClockRow)
        .where(RoomClockRow.id == clock_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = result.scalar_one_or_none()
    return (await _clocks_from_rows(session, [row]))[0] if row else None


async def list_clocks(session: AsyncSession, room_id: uuid.UUID) -> list[Clock]:
    """Every clock of the Room in the Clocks page's order."""
    result = await session.execute(
        select(RoomClockRow)
        .where(RoomClockRow.room_id == room_id)
        .order_by(RoomClockRow.position, RoomClockRow.created_at)
    )
    return await _clocks_from_rows(session, list(result.scalars()))


async def list_clocks_by_ids(
    session: AsyncSession, clock_ids: Collection[uuid.UUID]
) -> list[Clock]:
    """These clocks, in the Clocks page's order."""
    if not clock_ids:
        return []
    result = await session.execute(
        select(RoomClockRow)
        .where(RoomClockRow.id.in_(clock_ids))
        .order_by(RoomClockRow.position, RoomClockRow.created_at)
    )
    return await _clocks_from_rows(session, list(result.scalars()))


async def count_clocks(session: AsyncSession, room_id: uuid.UUID) -> int:
    """How many clocks the Room holds, proposals included."""
    result = await session.execute(select(func.count()).where(RoomClockRow.room_id == room_id))
    return int(result.scalar_one())


async def count_clocks_for_document(
    session: AsyncSession, document_id: uuid.UUID, other_than: uuid.UUID | None = None
) -> int:
    """How many clocks link the Document, leaving `other_than` out."""
    query = select(func.count()).where(RoomClockRow.document_id == document_id)
    if other_than is not None:
        query = query.where(RoomClockRow.id != other_than)
    return int((await session.execute(query)).scalar_one())


async def next_position(session: AsyncSession, room_id: uuid.UUID) -> int:
    """The position after the Room's last clock."""
    result = await session.execute(
        select(func.max(RoomClockRow.position)).where(RoomClockRow.room_id == room_id)
    )
    last = result.scalar_one_or_none()
    return 0 if last is None else int(last) + 1


async def update_clock(session: AsyncSession, clock: Clock) -> Clock:
    """Writes every field of the clock and its labels and raises its revision
    by one. Returns `clock` with that revision."""
    row = await session.get(RoomClockRow, clock.id)
    if row is None:  # pragma: no cover - only a concurrent deletion
        raise LookupError(f"Clock {clock.id} not found")
    _write_clock(row, clock)
    row.revision = row.revision + 1
    await session.flush()
    await _set_labels(session, clock.id, clock.label_ids)
    return replace(clock, revision=row.revision)


async def set_positions(session: AsyncSession, clock_ids: Sequence[uuid.UUID]) -> None:
    """Puts the clocks in this order on the Clocks page."""
    for position, clock_id in enumerate(clock_ids):
        await session.execute(
            update(RoomClockRow).where(RoomClockRow.id == clock_id).values(position=position)
        )


async def delete_clock(session: AsyncSession, clock_id: uuid.UUID) -> None:
    """Deletes a clock with its marks, history, labels and grants."""
    await session.execute(delete(RoomClockRow).where(RoomClockRow.id == clock_id))


async def list_grants(
    session: AsyncSession, clock_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Each clock's Selective grants, in one query."""
    grants: dict[uuid.UUID, list[uuid.UUID]] = {clock_id: [] for clock_id in clock_ids}
    if clock_ids:
        rows = await session.execute(
            select(RoomClockGrantRow.clock_id, RoomClockGrantRow.user_id).where(
                RoomClockGrantRow.clock_id.in_(clock_ids)
            )
        )
        for clock_id, user_id in rows:
            grants[clock_id].append(user_id)
    return grants


async def set_grants(
    session: AsyncSession, clock_id: uuid.UUID, user_ids: Collection[uuid.UUID]
) -> None:
    """Replaces a clock's Selective grants."""
    await session.execute(delete(RoomClockGrantRow).where(RoomClockGrantRow.clock_id == clock_id))
    session.add_all(RoomClockGrantRow(clock_id=clock_id, user_id=user_id) for user_id in user_ids)
    await session.flush()


# --- Marks and history --------------------------------------------------------


def _mark_from_row(row: RoomClockMarkRow) -> ClockMark:
    """Maps a mark row."""
    return ClockMark(
        id=row.id,
        clock_id=row.clock_id,
        user_id=row.user_id,
        kind_id=row.kind_id,
        delta=row.delta,
        note=row.note,
        created_at=row.created_at,
        undone_at=row.undone_at,
    )


async def insert_mark(session: AsyncSession, mark: ClockMark) -> None:
    """Writes a mark."""
    session.add(
        RoomClockMarkRow(
            id=mark.id,
            clock_id=mark.clock_id,
            user_id=mark.user_id,
            kind_id=mark.kind_id,
            delta=mark.delta,
            note=mark.note,
            created_at=mark.created_at,
        )
    )
    await session.flush()


async def get_mark(session: AsyncSession, mark_id: uuid.UUID) -> ClockMark | None:
    """The mark, or None."""
    row = await session.get(RoomClockMarkRow, mark_id)
    return _mark_from_row(row) if row else None


async def set_mark_undone(session: AsyncSession, mark_id: uuid.UUID, now: datetime) -> None:
    """Takes a mark back."""
    await session.execute(
        update(RoomClockMarkRow).where(RoomClockMarkRow.id == mark_id).values(undone_at=now)
    )


async def list_live_marks(
    session: AsyncSession, clock_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[ClockMark]]:
    """Each clock's marks not taken back, oldest first, in one query."""
    marks: dict[uuid.UUID, list[ClockMark]] = {clock_id: [] for clock_id in clock_ids}
    if clock_ids:
        result = await session.execute(
            select(RoomClockMarkRow)
            .where(RoomClockMarkRow.clock_id.in_(clock_ids), RoomClockMarkRow.undone_at.is_(None))
            .order_by(RoomClockMarkRow.created_at, RoomClockMarkRow.id)
        )
        for row in result.scalars():
            marks[row.clock_id].append(_mark_from_row(row))
    return marks


async def insert_event(session: AsyncSession, event: ClockEvent) -> None:
    """Writes a history line."""
    session.add(
        RoomClockEventRow(
            id=event.id,
            clock_id=event.clock_id,
            user_id=event.user_id,
            action=event.action.value,
            details=event.details,
            created_at=event.created_at,
        )
    )
    await session.flush()


async def list_events(
    session: AsyncSession, clock_id: uuid.UUID, before: datetime | None, limit: int
) -> list[ClockEvent]:
    """A page of the clock's history, newest first, older than `before`."""
    query = select(RoomClockEventRow).where(RoomClockEventRow.clock_id == clock_id)
    if before is not None:
        query = query.where(RoomClockEventRow.created_at < before)
    result = await session.execute(
        query.order_by(RoomClockEventRow.created_at.desc(), RoomClockEventRow.id).limit(limit)
    )
    return [
        ClockEvent(
            id=row.id,
            clock_id=row.clock_id,
            user_id=row.user_id,
            action=HistoryAction(row.action),
            details=row.details,
            created_at=row.created_at,
        )
        for row in result.scalars()
    ]


# --- Groups -------------------------------------------------------------------


def _group_from_row(row: RoomClockGroupRow) -> ClockGroup:
    """Maps a group row."""
    return ClockGroup(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        mode=GroupMode(row.mode),
        position=row.position,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
        ended_at=row.ended_at,
        result=row.result,
        revision=row.revision,
    )


async def list_groups(session: AsyncSession, room_id: uuid.UUID) -> list[ClockGroup]:
    """The Room's groups in their order."""
    result = await session.execute(
        select(RoomClockGroupRow)
        .where(RoomClockGroupRow.room_id == room_id)
        .order_by(RoomClockGroupRow.position, RoomClockGroupRow.created_at)
    )
    return [_group_from_row(row) for row in result.scalars()]


async def get_group(session: AsyncSession, group_id: uuid.UUID) -> ClockGroup | None:
    """The group, or None."""
    row = await session.get(RoomClockGroupRow, group_id)
    return _group_from_row(row) if row else None


async def lock_group(session: AsyncSession, group_id: uuid.UUID) -> ClockGroup | None:
    """Takes the group's row lock and returns it as of the lock."""
    result = await session.execute(
        select(RoomClockGroupRow)
        .where(RoomClockGroupRow.id == group_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = result.scalar_one_or_none()
    return _group_from_row(row) if row else None


async def count_groups(session: AsyncSession, room_id: uuid.UUID) -> int:
    """How many groups the Room holds."""
    result = await session.execute(select(func.count()).where(RoomClockGroupRow.room_id == room_id))
    return int(result.scalar_one())


async def save_group(session: AsyncSession, group: ClockGroup) -> ClockGroup:
    """Inserts or rewrites a group, raising its revision by one."""
    row = await session.get(RoomClockGroupRow, group.id)
    if row is None:
        row = RoomClockGroupRow(
            id=group.id,
            room_id=group.room_id,
            created_by=group.created_by,
            created_at=group.created_at,
            # The +1 below makes a new group's first revision 0.
            revision=-1,
        )
        session.add(row)
    row.name = group.name
    row.mode = group.mode.value
    row.position = group.position
    row.ended_at = group.ended_at
    row.result = group.result
    row.updated_at = group.updated_at
    row.revision = row.revision + 1
    await session.flush()
    return replace(group, revision=row.revision)


async def delete_group(session: AsyncSession, group_id: uuid.UUID) -> None:
    """Deletes a group; its clocks stay, outside any group."""
    await session.execute(
        update(RoomClockRow)
        .where(RoomClockRow.group_id == group_id)
        .values(group_id=None, group_position=None, decisive_label=None)
    )
    await session.execute(delete(RoomClockGroupRow).where(RoomClockGroupRow.id == group_id))

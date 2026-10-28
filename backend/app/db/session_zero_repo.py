"""Session 0 boards (spec 46): rows to and from the domain dataclasses in
`app/domain/session_zero.py`. Reads return rows unfiltered; the API keeps
drafts to their authors (Decision 1)."""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlalchemy import ColumnElement, case, delete, func, literal, or_, select, union_all, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    SessionZeroCardReactionRow,
    SessionZeroCardRow,
    SessionZeroColumnRow,
    SessionZeroGroupRow,
    SessionZeroModuleRow,
    SessionZeroRoundRow,
    SessionZeroRow,
)
from app.domain.models import Reaction
from app.domain.relationship_maps import MapColor
from app.domain.session_zero import (
    Card,
    Column,
    Group,
    LinesVeilsKind,
    Module,
    ModuleKind,
    Round,
    StarsWishesKind,
    Timer,
    column_kind,
)

# A Retro column to create: its title and colour (spec 46c Decision 5).
RetroColumnSpec = tuple[str, MapColor]
# A module to create (spec 47): its kind, and a Retro module's columns.
ModuleSpec = tuple[ModuleKind, Sequence[RetroColumnSpec]]


def _timer(row: SessionZeroRow) -> Timer:
    return Timer(
        duration_s=row.timer_duration_s,
        ends_at=row.timer_ends_at,
        paused_remaining_s=row.timer_paused_remaining_s,
    )


def _round(row: SessionZeroRoundRow) -> Round:
    return Round(
        id=row.id,
        room_id=row.room_id,
        number=row.number,
        title=row.title,
        started_at=row.started_at,
        closed_at=row.closed_at,
        current_module_id=row.current_module_id,
    )


def _module(row: SessionZeroModuleRow) -> Module:
    return Module(
        id=row.id,
        round_id=row.round_id,
        kind=ModuleKind(row.kind),
        position=row.position,
        tag_id=row.tag_id,
        answers_revealed=row.answers_revealed,
        players_bypass_creation_rule=row.players_bypass_creation_rule,
        document_id=row.document_id,
    )


def _column(row: SessionZeroColumnRow) -> Column:
    return Column(
        id=row.id,
        room_id=row.room_id,
        round_id=row.round_id,
        kind=column_kind(row.kind) if row.kind else None,
        title=row.title,
        position=row.position,
        color=MapColor(row.color),
        module_id=row.module_id,
    )


def _card(row: SessionZeroCardRow) -> Card:
    return Card(
        id=row.id,
        room_id=row.room_id,
        column_id=row.column_id,
        author_id=row.author_id,
        body=row.body,
        anonymous=row.anonymous,
        published_at=row.published_at,
        source_card_id=row.source_card_id,
        promoted_by=row.promoted_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
        group_id=row.group_id,
        position=row.position,
    )


def _group(row: SessionZeroGroupRow) -> Group:
    return Group(id=row.id, column_id=row.column_id, title=row.title, position=row.position)


async def get_state(
    session: AsyncSession, room_id: uuid.UUID, *, lock: bool = False
) -> tuple[int, Timer] | None:
    """The Room's Session 0 revision and timer, or `None` before it is
    started. `lock` takes its row lock, which every write holds, so the
    Room's board writes (and their revision) happen one at a time."""
    statement = select(SessionZeroRow).where(SessionZeroRow.room_id == room_id)
    if lock:
        statement = statement.with_for_update()
    row = (await session.execute(statement)).scalar_one_or_none()
    return None if row is None else (row.revision, _timer(row))


async def start(
    session: AsyncSession,
    room_id: uuid.UUID,
    chain: Sequence[ModuleSpec],
    now: datetime,
) -> bool:
    """Creates the Room's Session 0 with round 1, its chain of modules (the
    first one current) and the three Lines & Veils columns. Returns
    `False`, changing nothing, when it already exists (two members starting
    it at once both succeed)."""
    created = await session.execute(
        insert(SessionZeroRow)
        .values(room_id=room_id, revision=0, created_at=now)
        .on_conflict_do_nothing()
        .returning(SessionZeroRow.room_id)
    )
    if created.scalar_one_or_none() is None:
        return False
    await add_round(session, room_id, 1, None, chain, now)
    for position, kind in enumerate(LinesVeilsKind):
        session.add(
            SessionZeroColumnRow(
                id=uuid.uuid4(), room_id=room_id, kind=kind.value, title="", position=position
            )
        )
    await session.flush()
    return True


async def add_module(
    session: AsyncSession,
    room_id: uuid.UUID,
    round_id: uuid.UUID,
    spec: ModuleSpec,
    position: int,
    now: datetime,
) -> uuid.UUID:
    """Adds a module to a round's chain at `position`, with its columns: a
    Retro module's given ones, a Stars and Wishes module's two fixed ones
    (spec 47 Decision 7), none for Lines & Veils (Room-wide)."""
    kind, retro_columns = spec
    module_id = uuid.uuid4()
    session.add(
        SessionZeroModuleRow(
            id=module_id,
            room_id=room_id,
            round_id=round_id,
            kind=kind.value,
            position=position,
            created_at=now,
        )
    )
    await session.flush()
    columns: list[tuple[str, MapColor, str | None]] = []
    if kind is ModuleKind.RETRO:
        columns = [(title, color, None) for title, color in retro_columns]
    elif kind is ModuleKind.STARS_WISHES:
        columns = [("", MapColor.DEFAULT, fixed.value) for fixed in StarsWishesKind]
    for column_position, (title, color, fixed_kind) in enumerate(columns):
        session.add(
            SessionZeroColumnRow(
                id=uuid.uuid4(),
                room_id=room_id,
                round_id=round_id,
                module_id=module_id,
                kind=fixed_kind,
                title=title,
                position=column_position,
                color=color.value,
            )
        )
    await session.flush()
    return module_id


async def list_modules(session: AsyncSession, room_id: uuid.UUID) -> list[Module]:
    """Every module of the Room, round by round, each chain in order."""
    result = await session.execute(
        select(SessionZeroModuleRow)
        .where(SessionZeroModuleRow.room_id == room_id)
        .order_by(SessionZeroModuleRow.position, SessionZeroModuleRow.id)
    )
    return [_module(row) for row in result.scalars()]


async def delete_module(session: AsyncSession, module_id: uuid.UUID) -> None:
    """Deletes a module; its columns and their post-its go with it."""
    await session.execute(delete(SessionZeroModuleRow).where(SessionZeroModuleRow.id == module_id))
    await session.flush()


async def set_module_positions(session: AsyncSession, module_ids: Sequence[uuid.UUID]) -> None:
    """Stores a chain's order, first to last."""
    for position, module_id in enumerate(module_ids):
        await session.execute(
            update(SessionZeroModuleRow)
            .where(SessionZeroModuleRow.id == module_id)
            .values(position=position)
        )


async def set_module_settings(
    session: AsyncSession, module_id: uuid.UUID, **values: object
) -> None:
    """Changes a module's settings: a Questions one's `tag_id`,
    `answers_revealed`, `players_bypass_creation_rule` (spec 47_2), a DDI
    one's `document_id` (47_3)."""
    await session.execute(
        update(SessionZeroModuleRow).where(SessionZeroModuleRow.id == module_id).values(**values)
    )


async def set_current_module(
    session: AsyncSession, round_id: uuid.UUID, module_id: uuid.UUID | None
) -> None:
    """Moves the table to another step of the round's chain (spec 47
    Decision 4)."""
    await session.execute(
        update(SessionZeroRoundRow)
        .where(SessionZeroRoundRow.id == round_id)
        .values(current_module_id=module_id)
    )


async def delete_session_zero(session: AsyncSession, room_id: uuid.UUID) -> None:
    """Deletes the Room's Session 0 and everything in it (spec 46c
    Decision 3): rounds, columns, groups, post-its, reactions, timer."""
    await session.execute(delete(SessionZeroRow).where(SessionZeroRow.room_id == room_id))
    await session.flush()


async def bump_revision(session: AsyncSession, room_id: uuid.UUID) -> int:
    """Counts one write every member sees; returns the new revision."""
    result = await session.execute(
        update(SessionZeroRow)
        .where(SessionZeroRow.room_id == room_id)
        .values(revision=SessionZeroRow.revision + 1)
        .returning(SessionZeroRow.revision)
    )
    return result.scalar_one()


async def set_timer(session: AsyncSession, room_id: uuid.UUID, timer: Timer) -> None:
    """Stores the shared timer."""
    await session.execute(
        update(SessionZeroRow)
        .where(SessionZeroRow.room_id == room_id)
        .values(
            timer_duration_s=timer.duration_s,
            timer_ends_at=timer.ends_at,
            timer_paused_remaining_s=timer.paused_remaining_s,
        )
    )


async def list_rounds(session: AsyncSession, room_id: uuid.UUID) -> list[Round]:
    """The Room's rounds, first to last."""
    result = await session.execute(
        select(SessionZeroRoundRow)
        .where(SessionZeroRoundRow.room_id == room_id)
        .order_by(SessionZeroRoundRow.number)
    )
    return [_round(row) for row in result.scalars()]


async def close_round(session: AsyncSession, round_id: uuid.UUID, now: datetime) -> None:
    """Closes a round and drops its drafts: a draft never published was
    never shared (Decision 16)."""
    await session.execute(
        update(SessionZeroRoundRow).where(SessionZeroRoundRow.id == round_id).values(closed_at=now)
    )
    columns = select(SessionZeroColumnRow.id).where(SessionZeroColumnRow.round_id == round_id)
    await session.execute(
        delete(SessionZeroCardRow).where(
            SessionZeroCardRow.column_id.in_(columns), SessionZeroCardRow.published_at.is_(None)
        )
    )
    await session.flush()


async def add_round(
    session: AsyncSession,
    room_id: uuid.UUID,
    number: int,
    title: str | None,
    chain: Sequence[ModuleSpec],
    now: datetime,
) -> uuid.UUID:
    """Opens a new round with this chain of modules, in order, on its first
    step (spec 47 Decision 2)."""
    round_id = uuid.uuid4()
    session.add(
        SessionZeroRoundRow(
            id=round_id, room_id=room_id, number=number, title=title, started_at=now
        )
    )
    await session.flush()
    module_ids = [
        await add_module(session, room_id, round_id, spec, position, now)
        for position, spec in enumerate(chain)
    ]
    await set_current_module(session, round_id, module_ids[0])
    await session.flush()
    return round_id


async def list_columns(session: AsyncSession, room_id: uuid.UUID) -> list[Column]:
    """Every column of the Room, both boards and every round, in order."""
    result = await session.execute(
        select(SessionZeroColumnRow)
        .where(SessionZeroColumnRow.room_id == room_id)
        .order_by(SessionZeroColumnRow.position, SessionZeroColumnRow.id)
    )
    return [_column(row) for row in result.scalars()]


async def add_column(
    session: AsyncSession,
    room_id: uuid.UUID,
    module: Module,
    title: str,
    color: MapColor,
    position: int,
) -> uuid.UUID:
    """Adds a column to a Retro module."""
    column_id = uuid.uuid4()
    session.add(
        SessionZeroColumnRow(
            id=column_id,
            room_id=room_id,
            round_id=module.round_id,
            module_id=module.id,
            title=title,
            position=position,
            color=color.value,
        )
    )
    await session.flush()
    return column_id


async def update_column(session: AsyncSession, column_id: uuid.UUID, **values: object) -> None:
    """Writes a Retro column's `title` and/or `color`."""
    await session.execute(
        update(SessionZeroColumnRow).where(SessionZeroColumnRow.id == column_id).values(**values)
    )


async def delete_column(session: AsyncSession, column_id: uuid.UUID) -> None:
    """Deletes a Retro column; its post-its go with it."""
    await session.execute(delete(SessionZeroColumnRow).where(SessionZeroColumnRow.id == column_id))
    await session.flush()


async def set_column_positions(session: AsyncSession, column_ids: Sequence[uuid.UUID]) -> None:
    """Stores the columns' order, first to last."""
    for position, column_id in enumerate(column_ids):
        await session.execute(
            update(SessionZeroColumnRow)
            .where(SessionZeroColumnRow.id == column_id)
            .values(position=position)
        )


_CARD_ORDER = (SessionZeroCardRow.position, SessionZeroCardRow.created_at, SessionZeroCardRow.id)


async def list_cards(session: AsyncSession, column_ids: Collection[uuid.UUID]) -> list[Card]:
    """Every post-it in these columns, drafts included, by `position`
    (spec 46d Decision 7), the oldest first among equals."""
    result = await session.execute(
        select(SessionZeroCardRow)
        .where(SessionZeroCardRow.column_id.in_(column_ids))
        .order_by(*_CARD_ORDER)
    )
    return [_card(row) for row in result.scalars()]


async def list_group_cards(session: AsyncSession, group_ids: Collection[uuid.UUID]) -> list[Card]:
    """The post-its of these groups, drafts never among them, in order."""
    result = await session.execute(
        select(SessionZeroCardRow)
        .where(SessionZeroCardRow.group_id.in_(group_ids))
        .order_by(*_CARD_ORDER)
    )
    return [_card(row) for row in result.scalars()]


async def column_order(session: AsyncSession, column_id: uuid.UUID) -> list[tuple[uuid.UUID, bool]]:
    """Spec 46d Decision 7: the column's post-its in no group and its
    groups, everyone's drafts included, in their one order; each id with
    whether it is a group."""
    cards = select(
        SessionZeroCardRow.id,
        literal(False).label("is_group"),
        SessionZeroCardRow.position,
        SessionZeroCardRow.created_at,
    ).where(SessionZeroCardRow.column_id == column_id, SessionZeroCardRow.group_id.is_(None))
    groups = select(
        SessionZeroGroupRow.id,
        literal(True).label("is_group"),
        SessionZeroGroupRow.position,
        SessionZeroGroupRow.created_at,
    ).where(SessionZeroGroupRow.column_id == column_id)
    items = union_all(cards, groups).subquery()
    result = await session.execute(
        select(items.c.id, items.c.is_group).order_by(
            items.c.position, items.c.created_at, items.c.id
        )
    )
    return [(row.id, row.is_group) for row in result]


async def list_hidden_drafts(
    session: AsyncSession, column_id: uuid.UUID, viewer_id: uuid.UUID
) -> set[uuid.UUID]:
    """The column's drafts written by anyone but `viewer_id` (Decision 1)."""
    result = await session.execute(
        select(SessionZeroCardRow.id).where(
            SessionZeroCardRow.column_id == column_id,
            SessionZeroCardRow.published_at.is_(None),
            SessionZeroCardRow.author_id != viewer_id,
        )
    )
    return set(result.scalars())


async def next_position(session: AsyncSession, column_id: uuid.UUID) -> int:
    """The place after the column's last post-it in no group or group."""
    cards = select(func.max(SessionZeroCardRow.position)).where(
        SessionZeroCardRow.column_id == column_id, SessionZeroCardRow.group_id.is_(None)
    )
    groups = select(func.max(SessionZeroGroupRow.position)).where(
        SessionZeroGroupRow.column_id == column_id
    )
    last = (
        await session.execute(
            select(func.greatest(cards.scalar_subquery(), groups.scalar_subquery()))
        )
    ).scalar_one()
    return 0 if last is None else last + 1


async def set_order(
    session: AsyncSession, ids: Sequence[uuid.UUID], group_ids: Collection[uuid.UUID] = ()
) -> None:
    """Numbers these post-its and groups (`group_ids` says which are
    groups) 0, 1, 2... in the order given: a column's, or a group's."""
    positions = {item: index for index, item in enumerate(ids)}
    cards = {item: index for item, index in positions.items() if item not in group_ids}
    groups = {item: index for item, index in positions.items() if item in group_ids}
    if cards:
        await session.execute(
            update(SessionZeroCardRow)
            .where(SessionZeroCardRow.id.in_(cards))
            .values(position=case(cards, value=SessionZeroCardRow.id))
        )
    if groups:
        await session.execute(
            update(SessionZeroGroupRow)
            .where(SessionZeroGroupRow.id.in_(groups))
            .values(position=case(groups, value=SessionZeroGroupRow.id))
        )
    await session.flush()


async def get_card(session: AsyncSession, card_id: uuid.UUID) -> Card | None:
    """One post-it, whoever it belongs to."""
    row = await session.get(SessionZeroCardRow, card_id)
    return None if row is None else _card(row)


async def count_cards(
    session: AsyncSession,
    column_ids: Collection[uuid.UUID],
    *,
    drafts_of: uuid.UUID | None = None,
) -> int:
    """How many published post-its these columns hold, plus the drafts of
    `drafts_of` when given: never anyone else's drafts (Decision 1)."""
    seen: ColumnElement[bool] = SessionZeroCardRow.published_at.is_not(None)
    if drafts_of is not None:
        seen = or_(seen, SessionZeroCardRow.author_id == drafts_of)
    result = await session.execute(
        select(func.count())
        .select_from(SessionZeroCardRow)
        .where(SessionZeroCardRow.column_id.in_(column_ids), seen)
    )
    return result.scalar_one()


async def add_card(
    session: AsyncSession,
    room_id: uuid.UUID,
    column_id: uuid.UUID,
    author_id: uuid.UUID,
    body: str,
    now: datetime,
    *,
    published: bool = False,
) -> uuid.UUID:
    """Adds a draft (Decision 1), or a post-it published at once (the
    Master's own on Lines & Veils, spec 46c Decision 6), last in its column."""
    card_id = uuid.uuid4()
    session.add(
        SessionZeroCardRow(
            id=card_id,
            room_id=room_id,
            column_id=column_id,
            author_id=author_id,
            body=body,
            anonymous=False,
            published_at=now if published else None,
            position=await next_position(session, column_id),
            created_at=now,
            updated_at=now,
        )
    )
    await session.flush()
    return card_id


async def update_card(
    session: AsyncSession, card_id: uuid.UUID, now: datetime, **values: object
) -> None:
    """Writes the given columns of a post-it (`body`, `anonymous`,
    `published_at`, `column_id`, `group_id`, `position`) and stamps it
    updated."""
    await session.execute(
        update(SessionZeroCardRow)
        .where(SessionZeroCardRow.id == card_id)
        .values(updated_at=now, **values)
    )
    await session.flush()


async def copy_card(
    session: AsyncSession,
    original: Card,
    column_id: uuid.UUID,
    promoted_by: uuid.UUID,
    now: datetime,
) -> uuid.UUID:
    """The Lines & Veils copy of a published Retro post-it: same author,
    text and anonymity, published at once (Decisions 2 and 7), last in its
    column."""
    card_id = uuid.uuid4()
    session.add(
        SessionZeroCardRow(
            id=card_id,
            room_id=original.room_id,
            column_id=column_id,
            author_id=original.author_id,
            body=original.body,
            anonymous=original.anonymous,
            published_at=now,
            source_card_id=original.id,
            promoted_by=promoted_by,
            position=await next_position(session, column_id),
            created_at=now,
            updated_at=now,
        )
    )
    await session.flush()
    return card_id


async def list_drafts(
    session: AsyncSession, column_ids: Collection[uuid.UUID], author_id: uuid.UUID
) -> list[uuid.UUID]:
    """The author's drafts in these columns, oldest first."""
    result = await session.execute(
        select(SessionZeroCardRow.id)
        .where(
            SessionZeroCardRow.column_id.in_(column_ids),
            SessionZeroCardRow.author_id == author_id,
            SessionZeroCardRow.published_at.is_(None),
        )
        .order_by(SessionZeroCardRow.created_at, SessionZeroCardRow.id)
    )
    return list(result.scalars())


async def publish_cards(
    session: AsyncSession, card_ids: Collection[uuid.UUID], anonymous: bool, now: datetime
) -> None:
    """Publishes these drafts at once, all signed or all anonymous (spec 46c
    Decision 8)."""
    await session.execute(
        update(SessionZeroCardRow)
        .where(SessionZeroCardRow.id.in_(card_ids))
        .values(published_at=now, anonymous=anonymous, updated_at=now)
    )
    await session.flush()


async def list_groups(session: AsyncSession, column_ids: Collection[uuid.UUID]) -> list[Group]:
    """The groups of these columns, by `position`."""
    result = await session.execute(
        select(SessionZeroGroupRow)
        .where(SessionZeroGroupRow.column_id.in_(column_ids))
        .order_by(
            SessionZeroGroupRow.position, SessionZeroGroupRow.created_at, SessionZeroGroupRow.id
        )
    )
    return [_group(row) for row in result.scalars()]


async def get_group(session: AsyncSession, group_id: uuid.UUID) -> tuple[Group, uuid.UUID] | None:
    """A group and its Room."""
    row = await session.get(SessionZeroGroupRow, group_id)
    if row is None:
        return None
    return _group(row), row.room_id


async def add_group(
    session: AsyncSession, room_id: uuid.UUID, column_id: uuid.UUID, position: int, now: datetime
) -> uuid.UUID:
    """A new, untitled group in a column, at `position`."""
    group_id = uuid.uuid4()
    session.add(
        SessionZeroGroupRow(
            id=group_id,
            room_id=room_id,
            column_id=column_id,
            title=None,
            position=position,
            created_at=now,
        )
    )
    await session.flush()
    return group_id


async def set_group(
    session: AsyncSession, card_ids: Collection[uuid.UUID], group_id: uuid.UUID | None
) -> None:
    """Puts these post-its in a group, or takes them out of theirs (`None`)."""
    await session.execute(
        update(SessionZeroCardRow)
        .where(SessionZeroCardRow.id.in_(card_ids))
        .values(group_id=group_id)
    )
    await session.flush()


async def move_group(session: AsyncSession, group_id: uuid.UUID, column_id: uuid.UUID) -> None:
    """Moves a group and its post-its into another column (spec 46d
    Decision 7)."""
    await session.execute(
        update(SessionZeroGroupRow)
        .where(SessionZeroGroupRow.id == group_id)
        .values(column_id=column_id)
    )
    await session.execute(
        update(SessionZeroCardRow)
        .where(SessionZeroCardRow.group_id == group_id)
        .values(column_id=column_id)
    )
    await session.flush()


async def rename_group(session: AsyncSession, group_id: uuid.UUID, title: str | None) -> None:
    """Sets a group's title; `None` clears it."""
    await session.execute(
        update(SessionZeroGroupRow).where(SessionZeroGroupRow.id == group_id).values(title=title)
    )


async def delete_groups(session: AsyncSession, group_ids: Collection[uuid.UUID]) -> None:
    """Deletes these groups; their post-its stay, ungrouped."""
    await session.execute(delete(SessionZeroGroupRow).where(SessionZeroGroupRow.id.in_(group_ids)))
    await session.flush()


async def prune_groups(session: AsyncSession, column_id: uuid.UUID) -> bool:
    """Spec 46c Decision 9: a group left with fewer than two post-its
    dissolves, the one left taking the group's place in the column (spec
    46d Decision 7). Whether any did."""
    members = (
        select(func.count())
        .select_from(SessionZeroCardRow)
        .where(SessionZeroCardRow.group_id == SessionZeroGroupRow.id)
        .correlate(SessionZeroGroupRow)
        .scalar_subquery()
    )
    doomed = (
        await session.execute(
            select(SessionZeroGroupRow.id, SessionZeroGroupRow.position).where(
                SessionZeroGroupRow.column_id == column_id, members < 2
            )
        )
    ).all()
    for group_id, position in doomed:
        await session.execute(
            update(SessionZeroCardRow)
            .where(SessionZeroCardRow.group_id == group_id)
            .values(position=position)
        )
    await delete_groups(session, [group_id for group_id, _ in doomed])
    return bool(doomed)


async def list_copy_columns(session: AsyncSession, source_card_id: uuid.UUID) -> set[uuid.UUID]:
    """The columns that hold a copy of this original."""
    result = await session.execute(
        select(SessionZeroCardRow.column_id).where(
            SessionZeroCardRow.source_card_id == source_card_id
        )
    )
    return set(result.scalars())


async def list_sources_in_column(session: AsyncSession, column_id: uuid.UUID) -> set[uuid.UUID]:
    """The originals the column's copies came from."""
    result = await session.execute(
        select(SessionZeroCardRow.source_card_id).where(
            SessionZeroCardRow.column_id == column_id,
            SessionZeroCardRow.source_card_id.is_not(None),
        )
    )
    return {source for source in result.scalars() if source is not None}


async def delete_card(session: AsyncSession, card_id: uuid.UUID) -> None:
    """Deletes a post-it; its copies stay, unlinked (Decision 9)."""
    await session.execute(delete(SessionZeroCardRow).where(SessionZeroCardRow.id == card_id))
    await session.flush()


async def list_reactions(
    session: AsyncSession, card_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[Reaction]]:
    """Each post-it's reactions, oldest first, in one query. `Reaction`'s
    `comment_id` holds the post-it's id."""
    reactions: dict[uuid.UUID, list[Reaction]] = defaultdict(list)
    if not card_ids:
        return reactions
    result = await session.execute(
        select(SessionZeroCardReactionRow)
        .where(SessionZeroCardReactionRow.card_id.in_(card_ids))
        .order_by(SessionZeroCardReactionRow.created_at, SessionZeroCardReactionRow.user_id)
    )
    for row in result.scalars():
        reactions[row.card_id].append(
            Reaction(
                comment_id=row.card_id,
                user_id=row.user_id,
                emoji=row.emoji,
                created_at=row.created_at,
            )
        )
    return reactions


async def add_reaction(
    session: AsyncSession, card_id: uuid.UUID, user_id: uuid.UUID, emoji: str, now: datetime
) -> bool:
    """Adds the member's emoji; already there is a no-op. Whether it was
    added."""
    result = await session.execute(
        insert(SessionZeroCardReactionRow)
        .values(card_id=card_id, user_id=user_id, emoji=emoji, created_at=now)
        .on_conflict_do_nothing()
    )
    await session.flush()
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def remove_reaction(
    session: AsyncSession, card_id: uuid.UUID, user_id: uuid.UUID, emoji: str
) -> bool:
    """Removes the member's emoji, if it was there. Whether it was."""
    result = await session.execute(
        delete(SessionZeroCardReactionRow).where(
            SessionZeroCardReactionRow.card_id == card_id,
            SessionZeroCardReactionRow.user_id == user_id,
            SessionZeroCardReactionRow.emoji == emoji,
        )
    )
    await session.flush()
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def list_cards_by_author(session: AsyncSession, user_id: uuid.UUID) -> list[Card]:
    """Every post-it the user wrote, drafts and copies included, oldest
    first (their data export, spec 31)."""
    result = await session.execute(
        select(SessionZeroCardRow)
        .where(SessionZeroCardRow.author_id == user_id)
        .order_by(SessionZeroCardRow.created_at, SessionZeroCardRow.id)
    )
    return [_card(row) for row in result.scalars()]

"""Session 0 boards (spec 46): rows to and from the domain dataclasses in
`app/domain/session_zero.py`. Reads return rows unfiltered; the API keeps
drafts to their authors (Decision 1)."""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlalchemy import ColumnElement, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    SessionZeroCardReactionRow,
    SessionZeroCardRow,
    SessionZeroColumnRow,
    SessionZeroRoundRow,
    SessionZeroRow,
)
from app.domain.models import Reaction
from app.domain.session_zero import Card, Column, LinesVeilsKind, Round, Timer


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
    )


def _column(row: SessionZeroColumnRow) -> Column:
    return Column(
        id=row.id,
        room_id=row.room_id,
        round_id=row.round_id,
        kind=LinesVeilsKind(row.kind) if row.kind else None,
        title=row.title,
        position=row.position,
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
    )


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
    session: AsyncSession, room_id: uuid.UUID, retro_titles: Sequence[str], now: datetime
) -> bool:
    """Creates the Room's Session 0 with round 1, its Retro columns and the
    three Lines & Veils columns. Returns `False`, changing nothing, when it
    already exists (two members starting it at once both succeed)."""
    created = await session.execute(
        insert(SessionZeroRow)
        .values(room_id=room_id, revision=0, created_at=now)
        .on_conflict_do_nothing()
        .returning(SessionZeroRow.room_id)
    )
    if created.scalar_one_or_none() is None:
        return False
    round_id = uuid.uuid4()
    session.add(
        SessionZeroRoundRow(id=round_id, room_id=room_id, number=1, title=None, started_at=now)
    )
    await session.flush()
    for position, title in enumerate(retro_titles):
        session.add(
            SessionZeroColumnRow(
                id=uuid.uuid4(), room_id=room_id, round_id=round_id, title=title, position=position
            )
        )
    for position, kind in enumerate(LinesVeilsKind):
        session.add(
            SessionZeroColumnRow(
                id=uuid.uuid4(), room_id=room_id, kind=kind.value, title="", position=position
            )
        )
    await session.flush()
    return True


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
    retro_titles: Sequence[str],
    now: datetime,
) -> uuid.UUID:
    """Opens a new round with these Retro columns, in order."""
    round_id = uuid.uuid4()
    session.add(
        SessionZeroRoundRow(
            id=round_id, room_id=room_id, number=number, title=title, started_at=now
        )
    )
    await session.flush()
    for position, column_title in enumerate(retro_titles):
        session.add(
            SessionZeroColumnRow(
                id=uuid.uuid4(),
                room_id=room_id,
                round_id=round_id,
                title=column_title,
                position=position,
            )
        )
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
    session: AsyncSession, room_id: uuid.UUID, round_id: uuid.UUID, title: str, position: int
) -> uuid.UUID:
    """Adds a Retro column to a round."""
    column_id = uuid.uuid4()
    session.add(
        SessionZeroColumnRow(
            id=column_id, room_id=room_id, round_id=round_id, title=title, position=position
        )
    )
    await session.flush()
    return column_id


async def rename_column(session: AsyncSession, column_id: uuid.UUID, title: str) -> None:
    """Renames a Retro column."""
    await session.execute(
        update(SessionZeroColumnRow).where(SessionZeroColumnRow.id == column_id).values(title=title)
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


async def list_cards(session: AsyncSession, column_ids: Collection[uuid.UUID]) -> list[Card]:
    """Every post-it in these columns, drafts included, oldest first."""
    result = await session.execute(
        select(SessionZeroCardRow)
        .where(SessionZeroCardRow.column_id.in_(column_ids))
        .order_by(SessionZeroCardRow.created_at, SessionZeroCardRow.id)
    )
    return [_card(row) for row in result.scalars()]


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
) -> uuid.UUID:
    """Adds a draft (Decision 1)."""
    card_id = uuid.uuid4()
    session.add(
        SessionZeroCardRow(
            id=card_id,
            room_id=room_id,
            column_id=column_id,
            author_id=author_id,
            body=body,
            anonymous=False,
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
    `published_at`, `column_id`) and stamps it updated."""
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
    text and anonymity, published at once (Decisions 2 and 7)."""
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
            created_at=now,
            updated_at=now,
        )
    )
    await session.flush()
    return card_id


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

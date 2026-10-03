"""Reveals and their recipients (spec 22). Readers return rows unfiltered; the
caller applies the visibility filter (Invariant 1)."""

import uuid
from collections.abc import Collection
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RevealRecipientRow, RevealRow
from app.domain.models import ContentKind, Reveal


def _reveal_from_row(row: RevealRow) -> Reveal:
    """Maps a `reveals` row to the domain `Reveal`."""
    return Reveal(
        id=row.id,
        room_id=row.room_id,
        kind=ContentKind(row.content_kind),
        document_id=row.document_id,
        note_id=row.note_id,
        comment_id=row.comment_id,
        revealed_by=row.revealed_by,
        revealed_at=row.revealed_at,
    )


async def insert_reveal(
    session: AsyncSession, reveal: Reveal, recipient_ids: Collection[uuid.UUID]
) -> None:
    """Writes a Reveal and one unseen recipient row per member who gained
    access, in the caller's transaction."""
    session.add(
        RevealRow(
            id=reveal.id,
            room_id=reveal.room_id,
            content_kind=reveal.kind.value,
            document_id=reveal.document_id,
            note_id=reveal.note_id,
            comment_id=reveal.comment_id,
            revealed_by=reveal.revealed_by,
            revealed_at=reveal.revealed_at,
        )
    )
    await session.flush()
    for user_id in recipient_ids:
        session.add(RevealRecipientRow(reveal_id=reveal.id, user_id=user_id, seen_at=None))
    await session.flush()


async def list_unseen_reveals(session: AsyncSession, user_id: uuid.UUID) -> list[Reveal]:
    """Every Reveal the user is a recipient of and hasn't opened, in any
    Room, oldest first. Not yet filtered: the content may have been hidden
    again since."""
    result = await session.execute(
        select(RevealRow)
        .join(RevealRecipientRow, RevealRecipientRow.reveal_id == RevealRow.id)
        .where(RevealRecipientRow.user_id == user_id, RevealRecipientRow.seen_at.is_(None))
        .order_by(RevealRow.revealed_at, RevealRow.id)
    )
    return [_reveal_from_row(row) for row in result.scalars()]


async def mark_seen_in_document(
    session: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID, now: datetime
) -> list[Reveal]:
    """Marks seen, at `now`, every unseen Reveal of the user about the
    Document, its Notes or its Comments, and returns those Reveals: opening
    the Document opens all of them (spec 22 Decision 3)."""
    unseen = (
        select(RevealRow)
        .join(RevealRecipientRow, RevealRecipientRow.reveal_id == RevealRow.id)
        .where(
            RevealRow.document_id == document_id,
            RevealRecipientRow.user_id == user_id,
            RevealRecipientRow.seen_at.is_(None),
        )
    )
    reveals = [_reveal_from_row(row) for row in (await session.execute(unseen)).scalars()]
    if reveals:
        await session.execute(
            update(RevealRecipientRow)
            .where(
                RevealRecipientRow.user_id == user_id,
                RevealRecipientRow.reveal_id.in_([reveal.id for reveal in reveals]),
                RevealRecipientRow.seen_at.is_(None),
            )
            .values(seen_at=now)
        )
        await session.flush()
    return reveals


async def delete_recipients_in_room(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Drops the user's recipient rows for the Room's Reveals, for when they
    leave or are removed: rejoining starts afresh, like Document reads."""
    room_reveals = select(RevealRow.id).where(RevealRow.room_id == room_id)
    await session.execute(
        delete(RevealRecipientRow).where(
            RevealRecipientRow.user_id == user_id,
            RevealRecipientRow.reveal_id.in_(room_reveals),
        )
    )
    await session.flush()

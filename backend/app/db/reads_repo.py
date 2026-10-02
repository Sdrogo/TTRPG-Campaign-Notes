"""Document reads (spec 19b): when each member last opened each Document, and
the Comments posted since. Readers return rows unfiltered; the visibility
filter is applied by the caller (Invariant 1)."""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import and_, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.comments_repo import comment_from_row
from app.db.models import DocumentReadRow, DocumentRow, PostRow
from app.domain.models import Comment, PostKind


async def get_last_read_at(
    session: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID
) -> datetime | None:
    """When the user last opened the Document, or None if they never did."""
    row = await session.get(DocumentReadRow, (user_id, document_id))
    return row.last_read_at if row else None


async def mark_read(
    session: AsyncSession, user_id: uuid.UUID, document_id: uuid.UUID, now: datetime
) -> datetime | None:
    """Records that the user opened the Document at `now`, and returns the
    previous time (None on a first visit). The row is locked while it is read,
    so two concurrent visits can't both report the same "before"; the time
    never moves backwards."""
    previous = (
        select(DocumentReadRow.last_read_at)
        .where(DocumentReadRow.user_id == user_id, DocumentReadRow.document_id == document_id)
        .with_for_update()
    )
    before = (await session.execute(previous)).scalar_one_or_none()
    statement = insert(DocumentReadRow).values(
        user_id=user_id, document_id=document_id, last_read_at=now
    )
    statement = statement.on_conflict_do_update(
        index_elements=[DocumentReadRow.user_id, DocumentReadRow.document_id],
        set_={"last_read_at": statement.excluded.last_read_at},
        where=DocumentReadRow.last_read_at < statement.excluded.last_read_at,
    )
    await session.execute(statement)
    await session.flush()
    return before


async def list_last_read_for_documents(
    session: AsyncSession, user_id: uuid.UUID, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, datetime]:
    """When the user last opened each of these Documents, in one query; a
    Document they never opened is absent."""
    if not document_ids:
        return {}
    result = await session.execute(
        select(DocumentReadRow.document_id, DocumentReadRow.last_read_at).where(
            DocumentReadRow.user_id == user_id, DocumentReadRow.document_id.in_(document_ids)
        )
    )
    return {document_id: last_read_at for document_id, last_read_at in result}


async def list_comments_since_last_read(
    session: AsyncSession, user_id: uuid.UUID, document_ids: Sequence[uuid.UUID]
) -> list[Comment]:
    """In one query for all these Documents, the live Comments created after
    the user last opened their Document and written by someone else: the
    candidates for the unread count (spec 19b). Documents never opened bring
    none. Not yet filtered for any viewer."""
    if not document_ids:
        return []
    result = await session.execute(
        select(PostRow)
        .join(
            DocumentReadRow,
            and_(
                DocumentReadRow.document_id == PostRow.document_id,
                DocumentReadRow.user_id == user_id,
            ),
        )
        .where(
            PostRow.document_id.in_(document_ids),
            PostRow.kind == PostKind.COMMENT.value,
            PostRow.deleted_at.is_(None),
            PostRow.author_id != user_id,
            PostRow.created_at > DocumentReadRow.last_read_at,
        )
    )
    return [comment_from_row(row) for row in result.scalars()]


async def delete_reads_in_room(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Drops the user's reads of every Document of the Room, for when they
    leave or are removed (spec 19b): rejoining starts afresh."""
    room_documents = select(DocumentRow.id).where(DocumentRow.room_id == room_id)
    await session.execute(
        delete(DocumentReadRow).where(
            DocumentReadRow.user_id == user_id, DocumentReadRow.document_id.in_(room_documents)
        )
    )
    await session.flush()

"""A Room's Tags."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TagRow
from app.domain.models import Tag


def _tag_from_row(row: TagRow) -> Tag:
    """Maps a `tags` row to the domain `Tag`."""
    return Tag(id=row.id, room_id=row.room_id, name=row.name, category=row.category)


async def list_tags(session: AsyncSession, room_id: uuid.UUID) -> list[Tag]:
    """Every Tag in the Room."""
    result = await session.execute(select(TagRow).where(TagRow.room_id == room_id))
    return [_tag_from_row(row) for row in result.scalars()]


async def insert_tag(session: AsyncSession, tag: Tag) -> None:
    """Adds a Tag. A duplicate name in the same Room raises
    `IntegrityError`."""
    session.add(TagRow(id=tag.id, room_id=tag.room_id, name=tag.name, category=tag.category))
    await session.flush()


async def get_tags_by_ids(
    session: AsyncSession, room_id: uuid.UUID, tag_ids: list[uuid.UUID]
) -> list[Tag]:
    """The Tags among `tag_ids` that belong to this Room - so a shorter result
    means some ids are foreign or unknown."""
    if not tag_ids:
        return []
    result = await session.execute(
        select(TagRow).where(TagRow.room_id == room_id, TagRow.id.in_(tag_ids))
    )
    return [_tag_from_row(row) for row in result.scalars()]

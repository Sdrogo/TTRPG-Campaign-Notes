"""A Room's Tags."""

import uuid
from collections.abc import Mapping

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TagCombinationRow, TagCombinationTagRow, TagRow
from app.domain.models import Tag, TagCombination
from app.domain.tags import PlannedCombination


def _tag_from_row(row: TagRow) -> Tag:
    """Maps a `tags` row to the domain `Tag`."""
    return Tag(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        category=row.category,
        main_position=row.main_position,
    )


async def list_tags(session: AsyncSession, room_id: uuid.UUID) -> list[Tag]:
    """Every Tag in the Room."""
    result = await session.execute(select(TagRow).where(TagRow.room_id == room_id))
    return [_tag_from_row(row) for row in result.scalars()]


async def insert_tag(session: AsyncSession, tag: Tag) -> None:
    """Adds a Tag. A duplicate name in the same Room raises
    `IntegrityError`."""
    session.add(
        TagRow(
            id=tag.id,
            room_id=tag.room_id,
            name=tag.name,
            category=tag.category,
            main_position=tag.main_position,
        )
    )
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


async def set_main_positions(
    session: AsyncSession, room_id: uuid.UUID, positions: Mapping[uuid.UUID, int | None]
) -> None:
    """Writes each listed Tag's `main_position` (None clears it). Only rows of
    this Room are touched, whatever ids `positions` holds."""
    for tag_id, position in positions.items():
        await session.execute(
            update(TagRow)
            .where(TagRow.id == tag_id, TagRow.room_id == room_id)
            .values(main_position=position)
        )
    await session.flush()


async def list_combinations(session: AsyncSession, room_id: uuid.UUID) -> list[TagCombination]:
    """Every Tag combination of the Room, in position order."""
    result = await session.execute(
        select(TagCombinationRow)
        .where(TagCombinationRow.room_id == room_id)
        .order_by(TagCombinationRow.position)
    )
    rows = list(result.scalars())
    if not rows:
        return []
    links = await session.execute(
        select(TagCombinationTagRow.combination_id, TagCombinationTagRow.tag_id).where(
            TagCombinationTagRow.combination_id.in_([row.id for row in rows])
        )
    )
    by_combination: dict[uuid.UUID, list[uuid.UUID]] = {row.id: [] for row in rows}
    for combination_id, tag_id in links.all():
        by_combination[combination_id].append(tag_id)
    return [
        TagCombination(
            id=row.id,
            room_id=row.room_id,
            position=row.position,
            tag_ids=tuple(by_combination[row.id]),
        )
        for row in rows
    ]


async def replace_combinations(
    session: AsyncSession, room_id: uuid.UUID, combinations: tuple[PlannedCombination, ...]
) -> None:
    """Replaces the Room's combinations with `combinations`. Their Tags must
    already be checked as belonging to the Room (`plan_main_items`)."""
    await session.execute(delete(TagCombinationRow).where(TagCombinationRow.room_id == room_id))
    for planned in combinations:
        combination_id = uuid.uuid4()
        session.add(
            TagCombinationRow(id=combination_id, room_id=room_id, position=planned.position)
        )
        await session.flush()
        for tag_id in planned.tag_ids:
            session.add(TagCombinationTagRow(combination_id=combination_id, tag_id=tag_id))
    await session.flush()


async def delete_tag(session: AsyncSession, room_id: uuid.UUID, tag_id: uuid.UUID) -> None:
    """Deletes the Tag row of this Room. Its Document links
    (`document_tags`) and combination links (`tag_combination_tags`) cascade
    at the database level; the combinations themselves are rewritten by the
    caller (`plan_tag_removal`)."""
    await session.execute(delete(TagRow).where(TagRow.id == tag_id, TagRow.room_id == room_id))
    await session.flush()

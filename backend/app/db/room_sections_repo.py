"""The Room's landing page (spec 55): Sections, their blocks, a Documents
block's Tags and groups. Rows map to `app/domain/room_sections.py`."""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import replace

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    RoomSectionBlockGroupRow,
    RoomSectionBlockGroupTagRow,
    RoomSectionBlockRow,
    RoomSectionBlockTagRow,
    RoomSectionRow,
)
from app.domain.room_sections import (
    Block,
    BlockKind,
    BlockMapKind,
    Section,
    SectionKind,
    SessionZeroFeature,
)


def _section_from_row(row: RoomSectionRow, blocks: Iterable[Block] = ()) -> Section:
    return Section(
        id=row.id,
        room_id=row.room_id,
        kind=SectionKind(row.kind),
        position=row.position,
        title=row.title,
        description=row.description,
        image_path=row.image_path,
        blocks=tuple(blocks),
    )


async def list_sections(session: AsyncSession, room_id: uuid.UUID) -> list[Section]:
    """The Room's Sections in their order, without their blocks."""
    rows = await session.scalars(
        select(RoomSectionRow)
        .where(RoomSectionRow.room_id == room_id)
        .order_by(RoomSectionRow.position, RoomSectionRow.created_at)
    )
    return [_section_from_row(row) for row in rows]


async def _blocks_for_sections(
    session: AsyncSession, section_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[Block]]:
    """Each Section's blocks in order, with their Tags and groups, in four
    queries whatever their number."""
    blocks: dict[uuid.UUID, list[Block]] = defaultdict(list)
    rows = list(
        await session.scalars(
            select(RoomSectionBlockRow)
            .where(RoomSectionBlockRow.section_id.in_(section_ids))
            .order_by(RoomSectionBlockRow.position)
        )
    )
    block_ids = [row.id for row in rows]
    tags: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for tag_row in await session.scalars(
        select(RoomSectionBlockTagRow).where(RoomSectionBlockTagRow.block_id.in_(block_ids))
    ):
        tags[tag_row.block_id].append(tag_row.tag_id)
    group_rows = list(
        await session.scalars(
            select(RoomSectionBlockGroupRow)
            .where(RoomSectionBlockGroupRow.block_id.in_(block_ids))
            .order_by(RoomSectionBlockGroupRow.position)
        )
    )
    group_tags: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for group_tag in await session.scalars(
        select(RoomSectionBlockGroupTagRow).where(
            RoomSectionBlockGroupTagRow.group_id.in_([g.id for g in group_rows])
        )
    ):
        group_tags[group_tag.group_id].append(group_tag.tag_id)
    groups: dict[uuid.UUID, list[tuple[uuid.UUID, ...]]] = defaultdict(list)
    for group in group_rows:
        # A group's Tags have no order of their own: sorted, so a block reads
        # the same every time.
        groups[group.block_id].append(tuple(sorted(group_tags[group.id])))
    for row in rows:
        blocks[row.section_id].append(
            Block(
                id=row.id,
                kind=BlockKind(row.kind),
                position=row.position,
                heading=row.heading,
                tag_ids=tuple(sorted(tags[row.id])),
                groups=tuple(groups[row.id]),
                map_kind=BlockMapKind(row.map_kind) if row.map_kind else None,
                features=tuple(SessionZeroFeature(f) for f in row.features),
            )
        )
    return blocks


async def get_section(
    session: AsyncSession, room_id: uuid.UUID, section_id: uuid.UUID
) -> Section | None:
    """One Section of the Room with its blocks, or None (another Room's, or
    none)."""
    row = await session.scalar(
        select(RoomSectionRow).where(
            RoomSectionRow.id == section_id, RoomSectionRow.room_id == room_id
        )
    )
    if row is None:
        return None
    blocks = await _blocks_for_sections(session, [row.id])
    return _section_from_row(row, blocks[row.id])


async def list_sections_with_blocks(session: AsyncSession, room_id: uuid.UUID) -> list[Section]:
    """Every Section of the Room with its blocks, in order: what a copy of
    the Room is made from, and what a Tag's deletion rewrites."""
    sections = await list_sections(session, room_id)
    blocks = await _blocks_for_sections(session, [s.id for s in sections])
    return [replace(section, blocks=tuple(blocks[section.id])) for section in sections]


async def _add_blocks(
    session: AsyncSession, section_id: uuid.UUID, blocks: Iterable[Block]
) -> None:
    """Inserts `blocks` and their Tags and groups, flushing each level
    before the next points at it (the rows have no ORM relationships to
    order them by)."""
    blocks = list(blocks)
    session.add_all(
        RoomSectionBlockRow(
            id=block.id,
            section_id=section_id,
            position=block.position,
            kind=block.kind.value,
            heading=block.heading,
            map_kind=block.map_kind.value if block.map_kind else None,
            features=[f.value for f in block.features],
        )
        for block in blocks
    )
    await session.flush()
    groups: list[tuple[uuid.UUID, tuple[uuid.UUID, ...]]] = []
    for block in blocks:
        session.add_all(RoomSectionBlockTagRow(block_id=block.id, tag_id=t) for t in block.tag_ids)
        for position, group in enumerate(block.groups):
            group_id = uuid.uuid4()
            groups.append((group_id, group))
            session.add(RoomSectionBlockGroupRow(id=group_id, block_id=block.id, position=position))
    await session.flush()
    session.add_all(
        RoomSectionBlockGroupTagRow(group_id=group_id, tag_id=t)
        for group_id, group in groups
        for t in group
    )
    await session.flush()


async def insert_sections(session: AsyncSession, sections: Iterable[Section]) -> None:
    """Inserts Sections with their blocks, in the caller's transaction: a new
    Room's page cards, a Section the Master adds, a duplicated Room's
    landing page."""
    sections = list(sections)
    session.add_all(
        RoomSectionRow(
            id=section.id,
            room_id=section.room_id,
            position=section.position,
            kind=section.kind.value,
            title=section.title,
            description=section.description,
            image_path=section.image_path,
        )
        for section in sections
    )
    # The Sections exist before their blocks point at them.
    await session.flush()
    for section in sections:
        await _add_blocks(session, section.id, section.blocks)


async def update_section(session: AsyncSession, section: Section) -> None:
    """Saves a Section's title and description."""
    await session.execute(
        update(RoomSectionRow)
        .where(RoomSectionRow.id == section.id)
        .values(title=section.title, description=section.description, updated_at=func.now())
    )


async def set_section_image(session: AsyncSession, section_id: uuid.UUID, path: str | None) -> None:
    """Points the Section at another image (None removes it)."""
    await session.execute(
        update(RoomSectionRow)
        .where(RoomSectionRow.id == section_id)
        .values(image_path=path, updated_at=func.now())
    )


async def delete_section(session: AsyncSession, section_id: uuid.UUID) -> None:
    """Deletes a Section; its blocks, Tags and groups cascade."""
    await session.execute(delete(RoomSectionRow).where(RoomSectionRow.id == section_id))


async def set_positions(session: AsyncSession, positions: Mapping[uuid.UUID, int]) -> None:
    """Moves each Section to its new position."""
    for section_id, position in positions.items():
        await session.execute(
            update(RoomSectionRow).where(RoomSectionRow.id == section_id).values(position=position)
        )


async def replace_blocks(
    session: AsyncSession, section_id: uuid.UUID, blocks: Iterable[Block]
) -> None:
    """The Section's blocks become `blocks` (the editor saves the whole list,
    spec 55 Decision 11); the old ones and their Tags and groups go."""
    await session.execute(
        delete(RoomSectionBlockRow).where(RoomSectionBlockRow.section_id == section_id)
    )
    await session.flush()
    await _add_blocks(session, section_id, blocks)
    await session.execute(
        update(RoomSectionRow).where(RoomSectionRow.id == section_id).values(updated_at=func.now())
    )


async def replace_block(session: AsyncSession, section_id: uuid.UUID, block: Block) -> None:
    """Rewrites one block in place, its Tags and groups included."""
    await session.execute(delete(RoomSectionBlockRow).where(RoomSectionBlockRow.id == block.id))
    await session.flush()
    await _add_blocks(session, section_id, [block])


async def delete_block(session: AsyncSession, block_id: uuid.UUID) -> None:
    """Deletes one block with its Tags and groups."""
    await session.execute(delete(RoomSectionBlockRow).where(RoomSectionBlockRow.id == block_id))


async def list_image_paths_in_room(session: AsyncSession, room_id: uuid.UUID) -> list[str]:
    """The Storage paths of the Room's Section images, so a Room's deletion
    can schedule them for removal."""
    paths = await session.scalars(
        select(RoomSectionRow.image_path).where(
            RoomSectionRow.room_id == room_id, RoomSectionRow.image_path.is_not(None)
        )
    )
    return [path for path in paths if path is not None]

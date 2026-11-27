"""Glossary entries (spec 79): rows of `glossary_entries`, their keys, Tags,
linked Documents and Selective grants."""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    GlossaryEntryDocumentRow,
    GlossaryEntryGrantRow,
    GlossaryEntryKeyRow,
    GlossaryEntryRow,
    GlossaryEntryTagRow,
)
from app.domain.glossary import GlossaryEntry, entry_keys
from app.domain.models import DocumentVisibility


def _entry_from_row(row: GlossaryEntryRow) -> GlossaryEntry:
    """Maps a `glossary_entries` row to the domain `GlossaryEntry`."""
    return GlossaryEntry(
        id=row.id,
        room_id=row.room_id,
        term=row.term,
        aliases=tuple(row.aliases),
        definition=row.definition,
        visibility=DocumentVisibility(row.visibility),
        highlight=row.highlight,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def count_entries(session: AsyncSession, room_id: uuid.UUID) -> int:
    """How many entries the Room has, hidden ones included (the cap)."""
    result = await session.execute(
        select(func.count())
        .select_from(GlossaryEntryRow)
        .where(GlossaryEntryRow.room_id == room_id)
    )
    return int(result.scalar_one())


async def find_conflicting_entry(
    session: AsyncSession, room_id: uuid.UUID, keys: Sequence[str], except_entry: uuid.UUID | None
) -> bool:
    """Whether another entry of the Room already holds one of `keys`. Hidden
    entries count too: the answer is only "taken", never whose."""
    query = select(GlossaryEntryKeyRow.entry_id).where(
        GlossaryEntryKeyRow.room_id == room_id, GlossaryEntryKeyRow.key.in_(keys)
    )
    if except_entry is not None:
        query = query.where(GlossaryEntryKeyRow.entry_id != except_entry)
    return (await session.execute(query.limit(1))).first() is not None


async def _write_keys(session: AsyncSession, entry: GlossaryEntry) -> None:
    """Replaces the entry's keys with those of its term and aliases."""
    await session.execute(
        delete(GlossaryEntryKeyRow).where(GlossaryEntryKeyRow.entry_id == entry.id)
    )
    for key in entry_keys(entry.term, entry.aliases):
        session.add(GlossaryEntryKeyRow(entry_id=entry.id, key=key, room_id=entry.room_id))
    await session.flush()


async def insert_entry(session: AsyncSession, entry: GlossaryEntry) -> None:
    """Inserts an entry and its keys."""
    session.add(
        GlossaryEntryRow(
            id=entry.id,
            room_id=entry.room_id,
            term=entry.term,
            aliases=list(entry.aliases),
            alias_text=" ".join(entry.aliases),
            definition=entry.definition,
            visibility=entry.visibility.value,
            highlight=entry.highlight,
            created_by=entry.created_by,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )
    )
    await session.flush()
    await _write_keys(session, entry)


async def update_entry(session: AsyncSession, entry: GlossaryEntry) -> None:
    """Writes an entry's fields and keys. Raises `LookupError` if it no longer
    exists."""
    row = await session.get(GlossaryEntryRow, entry.id)
    if row is None:
        raise LookupError(f"Glossary entry {entry.id} not found")
    row.term = entry.term
    row.aliases = list(entry.aliases)
    row.alias_text = " ".join(entry.aliases)
    row.definition = entry.definition
    row.visibility = entry.visibility.value
    row.highlight = entry.highlight
    row.updated_at = entry.updated_at
    await session.flush()
    await _write_keys(session, entry)


async def delete_entry(session: AsyncSession, entry_id: uuid.UUID) -> None:
    """Deletes the entry; its keys, Tags, links and grants cascade."""
    await session.execute(delete(GlossaryEntryRow).where(GlossaryEntryRow.id == entry_id))


async def list_entries(session: AsyncSession, room_id: uuid.UUID) -> list[GlossaryEntry]:
    """Every entry of the Room by term, not yet filtered for any viewer."""
    result = await session.execute(
        select(GlossaryEntryRow)
        .where(GlossaryEntryRow.room_id == room_id)
        .order_by(func.lower(GlossaryEntryRow.term), GlossaryEntryRow.id)
    )
    return [_entry_from_row(row) for row in result.scalars()]


async def get_entry(session: AsyncSession, entry_id: uuid.UUID) -> GlossaryEntry | None:
    """The entry, or None."""
    row = await session.get(GlossaryEntryRow, entry_id)
    return None if row is None else _entry_from_row(row)


async def list_tag_ids(
    session: AsyncSession, entry_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The Tag ids of each entry (empty list for none)."""
    tags: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if entry_ids:
        result = await session.execute(
            select(GlossaryEntryTagRow.entry_id, GlossaryEntryTagRow.tag_id).where(
                GlossaryEntryTagRow.entry_id.in_(entry_ids)
            )
        )
        for entry_id, tag_id in result.tuples():
            tags[entry_id].append(tag_id)
    return tags


async def set_tag_ids(
    session: AsyncSession, entry_id: uuid.UUID, tag_ids: Sequence[uuid.UUID]
) -> None:
    """Replaces the entry's Tags."""
    await session.execute(
        delete(GlossaryEntryTagRow).where(GlossaryEntryTagRow.entry_id == entry_id)
    )
    for tag_id in dict.fromkeys(tag_ids):
        session.add(GlossaryEntryTagRow(entry_id=entry_id, tag_id=tag_id))
    await session.flush()


async def list_document_ids(
    session: AsyncSession, entry_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The linked Document ids of each entry, in display order, hidden ones
    included (the caller filters them for the viewer)."""
    documents: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if entry_ids:
        result = await session.execute(
            select(GlossaryEntryDocumentRow.entry_id, GlossaryEntryDocumentRow.document_id)
            .where(GlossaryEntryDocumentRow.entry_id.in_(entry_ids))
            .order_by(GlossaryEntryDocumentRow.position)
        )
        for entry_id, document_id in result.tuples():
            documents[entry_id].append(document_id)
    return documents


async def set_document_ids(
    session: AsyncSession, entry_id: uuid.UUID, document_ids: Sequence[uuid.UUID]
) -> None:
    """Replaces the entry's linked Documents, in this order."""
    await session.execute(
        delete(GlossaryEntryDocumentRow).where(GlossaryEntryDocumentRow.entry_id == entry_id)
    )
    for position, document_id in enumerate(document_ids):
        session.add(
            GlossaryEntryDocumentRow(entry_id=entry_id, document_id=document_id, position=position)
        )
    await session.flush()


async def list_grants(
    session: AsyncSession, entry_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The Selective grantees of each entry (empty list for none)."""
    grants: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if entry_ids:
        result = await session.execute(
            select(GlossaryEntryGrantRow.entry_id, GlossaryEntryGrantRow.user_id).where(
                GlossaryEntryGrantRow.entry_id.in_(entry_ids)
            )
        )
        for entry_id, user_id in result.tuples():
            grants[entry_id].append(user_id)
    return grants


async def set_grants(
    session: AsyncSession, entry_id: uuid.UUID, user_ids: Sequence[uuid.UUID]
) -> None:
    """Replaces the entry's Selective grantees."""
    await session.execute(
        delete(GlossaryEntryGrantRow).where(GlossaryEntryGrantRow.entry_id == entry_id)
    )
    for user_id in set(user_ids):
        session.add(GlossaryEntryGrantRow(entry_id=entry_id, user_id=user_id))
    await session.flush()

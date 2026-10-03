"""Notes: rows of `document_notes` and their Selective grants."""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import NoteRow, NoteVisibilityGrantRow
from app.domain.models import DocumentVisibility, Note


def _note_from_row(row: NoteRow) -> Note:
    """Maps a `document_notes` row to the domain `Note`."""
    return Note(
        id=row.id,
        document_id=row.document_id,
        title=row.title,
        description=row.description,
        visibility=DocumentVisibility(row.visibility),
        position=row.position,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def insert_note(
    session: AsyncSession, note: Note, selective_user_ids: Sequence[uuid.UUID]
) -> None:
    """Inserts a Note and its Selective grants; duplicate grantees are
    ignored."""
    session.add(
        NoteRow(
            id=note.id,
            document_id=note.document_id,
            title=note.title,
            description=note.description,
            visibility=note.visibility.value,
            position=note.position,
            created_by=note.created_by,
            created_at=note.created_at,
            updated_at=note.updated_at,
        )
    )
    await session.flush()
    for user_id in set(selective_user_ids):
        session.add(NoteVisibilityGrantRow(note_id=note.id, user_id=user_id))
    await session.flush()


async def list_notes_for_document(session: AsyncSession, document_id: uuid.UUID) -> list[Note]:
    """Every Note on the Document in display order. Not yet filtered for any
    viewer."""
    result = await session.execute(
        select(NoteRow)
        .where(NoteRow.document_id == document_id)
        .order_by(NoteRow.position, NoteRow.created_at, NoteRow.id)
    )
    return [_note_from_row(row) for row in result.scalars()]


async def get_notes_by_ids(session: AsyncSession, note_ids: Sequence[uuid.UUID]) -> list[Note]:
    """The Notes with these ids, in no particular order; missing ids are
    simply absent. Not yet filtered for any viewer."""
    result = await session.execute(select(NoteRow).where(NoteRow.id.in_(note_ids)))
    return [_note_from_row(row) for row in result.scalars()]


async def update_note(session: AsyncSession, note: Note) -> None:
    """Writes a Note's text, visibility and timestamp. Raises `LookupError` if
    it no longer exists."""
    row = await session.get(NoteRow, note.id)
    if row is None:
        raise LookupError(f"Note {note.id} not found")
    row.title = note.title
    row.description = note.description
    row.visibility = note.visibility.value
    row.updated_at = note.updated_at
    await session.flush()


async def delete_note(session: AsyncSession, note_id: uuid.UUID) -> None:
    """Deletes the Note; its grants cascade."""
    await session.execute(delete(NoteRow).where(NoteRow.id == note_id))


async def set_note_positions(session: AsyncSession, ordered_ids: Sequence[uuid.UUID]) -> None:
    """Gives each Note the index it has in `ordered_ids` as its position."""
    for position, note_id in enumerate(ordered_ids):
        await session.execute(
            update(NoteRow).where(NoteRow.id == note_id).values(position=position)
        )


async def list_grants_for_notes(
    session: AsyncSession, note_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The Selective grantees of each Note. A Note with none maps to an empty
    list."""
    grants: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not note_ids:
        return grants
    result = await session.execute(
        select(NoteVisibilityGrantRow.note_id, NoteVisibilityGrantRow.user_id).where(
            NoteVisibilityGrantRow.note_id.in_(note_ids)
        )
    )
    for note_id, user_id in result.tuples():
        grants[note_id].append(user_id)
    return grants


async def set_note_grants(
    session: AsyncSession, note_id: uuid.UUID, user_ids: Sequence[uuid.UUID]
) -> None:
    """Replaces the Note's Selective grantees with `user_ids`."""
    await session.execute(
        delete(NoteVisibilityGrantRow).where(NoteVisibilityGrantRow.note_id == note_id)
    )
    for user_id in set(user_ids):
        session.add(NoteVisibilityGrantRow(note_id=note_id, user_id=user_id))
    await session.flush()

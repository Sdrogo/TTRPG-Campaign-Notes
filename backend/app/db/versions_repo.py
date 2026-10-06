"""Revision rows of a Document's history (spec 24b): `document_versions`, the
Document's name and description plus its Notes as JSON."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DocumentVersionRow
from app.domain.models import DocumentVisibility
from app.domain.versions import DocumentState, NoteState, Version


def notes_to_json(notes: tuple[NoteState, ...]) -> list[dict[str, Any]]:
    """The `notes` column of a revision: plain JSON, ids as strings."""
    return [
        {
            "id": str(note.id),
            "title": note.title,
            "description": note.description,
            "visibility": note.visibility.value,
            "selective_user_ids": [str(user_id) for user_id in note.selective_user_ids],
        }
        for note in notes
    ]


def _notes_from_json(notes: list[dict[str, Any]]) -> tuple[NoteState, ...]:
    """Reads back what `notes_to_json` wrote."""
    return tuple(
        NoteState(
            uuid.UUID(note["id"]),
            note["title"],
            note["description"],
            DocumentVisibility(note["visibility"]),
            tuple(uuid.UUID(user_id) for user_id in note["selective_user_ids"]),
        )
        for note in notes
    )


def _from_row(row: DocumentVersionRow) -> Version:
    """Maps a `document_versions` row to the domain `Version`."""
    return Version(
        row.id,
        DocumentState(row.name, row.description, _notes_from_json(row.notes)),
        row.edited_by,
        row.created_at,
        row.updated_at,
    )


def _newest_first(document_id: uuid.UUID) -> Any:
    """The Document's revisions, newest first (ties broken by id)."""
    return (
        select(DocumentVersionRow)
        .where(DocumentVersionRow.document_id == document_id)
        .order_by(DocumentVersionRow.created_at.desc(), DocumentVersionRow.id.desc())
    )


async def list_versions(session: AsyncSession, document_id: uuid.UUID) -> list[Version]:
    """Every revision of the Document, newest first."""
    result = await session.execute(_newest_first(document_id))
    return [_from_row(row) for row in result.scalars()]


async def get_latest_version(session: AsyncSession, document_id: uuid.UUID) -> Version | None:
    """The newest revision of the Document, or None if it has none. One row is
    read, however long the history is: it runs on every save."""
    row = (await session.execute(_newest_first(document_id).limit(1))).scalar_one_or_none()
    return None if row is None else _from_row(row)


async def insert_version(session: AsyncSession, document_id: uuid.UUID, version: Version) -> None:
    """Stores a new revision of the Document."""
    session.add(
        DocumentVersionRow(
            id=version.id,
            document_id=document_id,
            name=version.state.name,
            description=version.state.description,
            notes=notes_to_json(version.state.notes),
            edited_by=version.edited_by,
            created_at=version.created_at,
            updated_at=version.updated_at,
        )
    )
    await session.flush()


async def update_version(session: AsyncSession, version: Version) -> None:
    """Writes the state and last-save time of an existing revision (a save
    merged into it, or a Note's visibility changed). Raises `LookupError` if
    it no longer exists."""
    row = await session.get(DocumentVersionRow, version.id)
    if row is None:
        raise LookupError(f"Version {version.id} not found")
    row.name = version.state.name
    row.description = version.state.description
    row.notes = notes_to_json(version.state.notes)
    row.updated_at = version.updated_at
    await session.flush()

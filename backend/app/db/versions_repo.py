"""Version history rows (spec 24): `document_versions` and `note_versions`.
Both tables have the same shape, so one set of functions serves both; the
Document's name and a Note's title are the version's `title`."""

import uuid
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DocumentVersionRow, NoteVersionRow
from app.domain.versions import Version

Subject = Literal["document", "note"]


def _from_document_row(row: DocumentVersionRow) -> Version:
    """Maps a `document_versions` row to the domain `Version`."""
    return Version(row.id, row.name, row.description, row.edited_by, row.created_at, row.updated_at)


def _from_note_row(row: NoteVersionRow) -> Version:
    """Maps a `note_versions` row to the domain `Version`."""
    return Version(
        row.id, row.title, row.description, row.edited_by, row.created_at, row.updated_at
    )


async def list_versions(
    session: AsyncSession, subject: Subject, subject_id: uuid.UUID
) -> list[Version]:
    """Every version of the Document or Note, newest first."""
    if subject == "document":
        document_result = await session.execute(
            select(DocumentVersionRow)
            .where(DocumentVersionRow.document_id == subject_id)
            .order_by(DocumentVersionRow.created_at.desc(), DocumentVersionRow.id.desc())
        )
        return [_from_document_row(row) for row in document_result.scalars()]
    note_result = await session.execute(
        select(NoteVersionRow)
        .where(NoteVersionRow.note_id == subject_id)
        .order_by(NoteVersionRow.created_at.desc(), NoteVersionRow.id.desc())
    )
    return [_from_note_row(row) for row in note_result.scalars()]


async def get_latest_version(
    session: AsyncSession, subject: Subject, subject_id: uuid.UUID
) -> Version | None:
    """The newest version of the Document or Note, or None if it has none."""
    versions = await list_versions(session, subject, subject_id)
    return versions[0] if versions else None


async def get_version(
    session: AsyncSession, subject: Subject, subject_id: uuid.UUID, version_id: uuid.UUID
) -> Version | None:
    """The version, only if it belongs to this Document or Note: an id from
    another one is simply absent."""
    if subject == "document":
        document_row = await session.get(DocumentVersionRow, version_id)
        if document_row is None or document_row.document_id != subject_id:
            return None
        return _from_document_row(document_row)
    note_row = await session.get(NoteVersionRow, version_id)
    if note_row is None or note_row.note_id != subject_id:
        return None
    return _from_note_row(note_row)


async def insert_version(
    session: AsyncSession, subject: Subject, subject_id: uuid.UUID, version: Version
) -> None:
    """Stores a new version of the Document or Note."""
    if subject == "document":
        session.add(
            DocumentVersionRow(
                id=version.id,
                document_id=subject_id,
                name=version.title,
                description=version.description,
                edited_by=version.edited_by,
                created_at=version.created_at,
                updated_at=version.updated_at,
            )
        )
    else:
        session.add(
            NoteVersionRow(
                id=version.id,
                note_id=subject_id,
                title=version.title,
                description=version.description,
                edited_by=version.edited_by,
                created_at=version.created_at,
                updated_at=version.updated_at,
            )
        )
    await session.flush()


async def update_version(session: AsyncSession, subject: Subject, version: Version) -> None:
    """Writes the text and last-save time of an existing version (a save merged
    into it). Raises `LookupError` if it no longer exists."""
    if subject == "document":
        document_row = await session.get(DocumentVersionRow, version.id)
        if document_row is None:
            raise LookupError(f"Version {version.id} not found")
        document_row.name = version.title
        document_row.description = version.description
        document_row.updated_at = version.updated_at
    else:
        note_row = await session.get(NoteVersionRow, version.id)
        if note_row is None:
            raise LookupError(f"Version {version.id} not found")
        note_row.title = version.title
        note_row.description = version.description
        note_row.updated_at = version.updated_at
    await session.flush()

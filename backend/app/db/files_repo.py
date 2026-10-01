"""PDF Attachments: rows of `document_files` (spec 16). Storage objects are
handled by `app/api/document_files.py` and `app/db/storage_cleanup.py`."""

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DocumentFileRow
from app.domain.models import DocumentFile

# Upload order, oldest first, so the list doesn't reshuffle as files arrive.
_FILE_ORDER = (DocumentFileRow.created_at, DocumentFileRow.id)


def _file_from_row(row: DocumentFileRow) -> DocumentFile:
    """Maps a `document_files` row to the domain `DocumentFile`."""
    return DocumentFile(
        id=row.id,
        document_id=row.document_id,
        storage_path=row.storage_path,
        display_name=row.display_name,
        size_bytes=row.size_bytes,
        content_type=row.content_type,
        uploaded_by=row.uploaded_by,
        created_at=row.created_at,
    )


async def insert_file(session: AsyncSession, file: DocumentFile) -> None:
    """Records a file already uploaded to Storage."""
    session.add(
        DocumentFileRow(
            id=file.id,
            document_id=file.document_id,
            storage_path=file.storage_path,
            display_name=file.display_name,
            size_bytes=file.size_bytes,
            content_type=file.content_type,
            uploaded_by=file.uploaded_by,
            created_at=file.created_at,
        )
    )
    await session.flush()


async def list_files(session: AsyncSession, document_id: uuid.UUID) -> list[DocumentFile]:
    """The Document's Attachments, oldest first. Not filtered: they have the
    Document's visibility (VR-12), so the caller must already know the viewer
    sees the Document."""
    result = await session.execute(
        select(DocumentFileRow)
        .where(DocumentFileRow.document_id == document_id)
        .order_by(*_FILE_ORDER)
    )
    return [_file_from_row(row) for row in result.scalars()]


async def list_files_for_documents(
    session: AsyncSession, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[DocumentFile]]:
    """`list_files` for many Documents in one query (deleting a Room)."""
    by_document: dict[uuid.UUID, list[DocumentFile]] = defaultdict(list)
    if not document_ids:
        return by_document
    result = await session.execute(
        select(DocumentFileRow)
        .where(DocumentFileRow.document_id.in_(document_ids))
        .order_by(*_FILE_ORDER)
    )
    for row in result.scalars():
        by_document[row.document_id].append(_file_from_row(row))
    return by_document


async def delete_files(session: AsyncSession, file_ids: Sequence[uuid.UUID]) -> None:
    """Deletes the rows only. Their Storage objects must be scheduled for
    removal in the same transaction (`storage_cleanup.schedule_removal`)."""
    await session.execute(delete(DocumentFileRow).where(DocumentFileRow.id.in_(file_ids)))
    await session.flush()

"""The writes of a Document import (spec 27 Backend): Tags, copied Documents
with their Owner, Tags, Notes and first revision, and the information of
Documents that are replaced. Each kind goes in a fixed number of statements
whatever the number of Documents (NFR-04); the caller owns the transaction, so
all of it is committed together or not at all."""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    DocumentOwnerRow,
    DocumentRow,
    DocumentTagRow,
    DocumentVersionRow,
    NoteRow,
    TagRow,
)
from app.db.versions_repo import notes_to_json
from app.domain.imports import PlannedDocument, PlannedNote, PlannedTag
from app.domain.versions import NoteState


def _note_rows(
    document_id: uuid.UUID, notes: Sequence[PlannedNote], importer: uuid.UUID, now: datetime
) -> list[NoteRow]:
    """The Notes of a Document in the order the file gave them."""
    return [
        NoteRow(
            id=note.id,
            document_id=document_id,
            title=note.title,
            description=note.text,
            visibility=note.visibility.value,
            position=position,
            created_by=importer,
            created_at=now,
            updated_at=now,
        )
        for position, note in enumerate(notes)
    ]


async def insert_tags(
    session: AsyncSession, room_id: uuid.UUID, tags: Sequence[PlannedTag]
) -> None:
    """Creates the Tags an import makes in the Room. A name another Tag of the
    Room already has (created meanwhile) raises `IntegrityError` and fails the
    whole import."""
    session.add_all(
        TagRow(id=tag.id, room_id=room_id, name=tag.name, category=tag.category) for tag in tags
    )
    await session.flush()


async def insert_copies(
    session: AsyncSession,
    room_id: uuid.UUID,
    importer: uuid.UUID,
    documents: Sequence[PlannedDocument],
    now: datetime,
) -> None:
    """Creates the copied Documents (Decision 5) with the importer as their
    Owner (D-12), their Tags and Notes, and a first revision of the history
    whose author is the importer (Decision 16). Selective grants are never
    written (Decision 12)."""
    session.add_all(
        DocumentRow(
            id=document.id,
            room_id=room_id,
            name=document.name,
            description=document.text,
            visibility=document.visibility.value,
            created_by=importer,
        )
        for document in documents
    )
    await session.flush()
    session.add_all(DocumentOwnerRow(document_id=d.id, user_id=importer) for d in documents)
    session.add_all(
        DocumentTagRow(document_id=d.id, tag_id=tag_id) for d in documents for tag_id in d.tag_ids
    )
    session.add_all(row for d in documents for row in _note_rows(d.id, d.notes, importer, now))
    session.add_all(
        DocumentVersionRow(
            id=uuid.uuid4(),
            document_id=d.id,
            name=d.name,
            description=d.text,
            notes=notes_to_json(
                tuple(NoteState(n.id, n.title, n.text, n.visibility) for n in d.notes)
            ),
            edited_by=importer,
            created_at=now,
            updated_at=now,
        )
        for d in documents
    )
    await session.flush()


async def replace_information(
    session: AsyncSession,
    importer: uuid.UUID,
    documents: Sequence[PlannedDocument],
    now: datetime,
) -> None:
    """Overwrites the information of existing Documents (Decision 6): name,
    description, Tags and Notes (the old Notes are removed, the file's
    created). Owners, visibility, grants, Character player, Comments,
    Attachments, images and Reveals are not touched. The caller records the
    new revision and the backlinks."""
    if not documents:
        return
    ids = [d.id for d in documents]
    # Loaded as entities (refreshed), not updated in bulk: the revision the
    # caller records next reads the Documents through this session.
    rows = await session.scalars(
        select(DocumentRow).where(DocumentRow.id.in_(ids)).execution_options(populate_existing=True)
    )
    by_id = {document.id: document for document in documents}
    for row in rows:
        row.name = by_id[row.id].name
        row.description = by_id[row.id].text
    await session.flush()
    await session.execute(delete(DocumentTagRow).where(DocumentTagRow.document_id.in_(ids)))
    await session.execute(delete(NoteRow).where(NoteRow.document_id.in_(ids)))
    session.add_all(
        DocumentTagRow(document_id=d.id, tag_id=tag_id) for d in documents for tag_id in d.tag_ids
    )
    session.add_all(row for d in documents for row in _note_rows(d.id, d.notes, importer, now))
    await session.flush()

"""Backlinks (spec 20): rows of `document_mentions`, rewritten whenever their
source is saved."""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import DocumentMentionRow
from app.domain.mentions import PlannedMention
from app.domain.models import DocumentMention, MentionSource, MentionSourceKind


def _mention_from_row(row: DocumentMentionRow) -> DocumentMention:
    """Maps a `document_mentions` row to the domain `DocumentMention`."""
    return DocumentMention(
        id=row.id,
        source_document_id=row.source_document_id,
        source_kind=MentionSourceKind(row.source_kind),
        note_id=row.note_id,
        comment_id=row.comment_id,
        target_document_id=row.target_document_id,
        target_tag_id=row.target_tag_id,
        excerpt=row.excerpt,
    )


async def replace_mentions(
    session: AsyncSession, source: MentionSource, planned: Sequence[PlannedMention]
) -> None:
    """Makes `planned` the only backlinks `source` holds."""
    if source.kind is MentionSourceKind.NOTE:
        where = DocumentMentionRow.note_id == source.note_id
    elif source.kind is MentionSourceKind.COMMENT:
        where = DocumentMentionRow.comment_id == source.comment_id
    else:
        where = (DocumentMentionRow.source_document_id == source.document_id) & (
            DocumentMentionRow.source_kind == MentionSourceKind.DESCRIPTION.value
        )
    await session.execute(delete(DocumentMentionRow).where(where))
    if planned:
        await session.execute(
            insert(DocumentMentionRow),
            [
                {
                    "id": uuid.uuid4(),
                    "source_document_id": source.document_id,
                    "source_kind": source.kind.value,
                    "note_id": source.note_id,
                    "comment_id": source.comment_id,
                    "target_document_id": mention.target_document_id,
                    "target_tag_id": mention.target_tag_id,
                    "excerpt": mention.excerpt,
                }
                for mention in planned
            ],
        )


async def list_mentions_of_document(
    session: AsyncSession, document_id: uuid.UUID
) -> list[DocumentMention]:
    """Every backlink to the Document, unfiltered."""
    rows = await session.scalars(
        select(DocumentMentionRow).where(DocumentMentionRow.target_document_id == document_id)
    )
    return [_mention_from_row(row) for row in rows]


async def list_mentions_of_tag(session: AsyncSession, tag_id: uuid.UUID) -> list[DocumentMention]:
    """Every backlink to the Tag, unfiltered."""
    rows = await session.scalars(
        select(DocumentMentionRow).where(DocumentMentionRow.target_tag_id == tag_id)
    )
    return [_mention_from_row(row) for row in rows]

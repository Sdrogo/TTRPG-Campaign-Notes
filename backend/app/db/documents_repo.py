import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.db.models import (
    DocumentImageRow,
    DocumentOwnerRow,
    DocumentRow,
    DocumentTagRow,
    DocumentVisibilityGrantRow,
)
from app.domain.documents import NewDocumentPlan
from app.domain.models import Document, DocumentImage, DocumentVisibility


async def _ids_by_document(
    session: AsyncSession,
    document_column: InstrumentedAttribute[uuid.UUID],
    id_column: InstrumentedAttribute[uuid.UUID],
    document_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """One query over a Document-to-id join table, grouped by Document.
    Backs the batch `*_for_documents` readers below; a Document with no rows
    maps to an empty list."""
    grouped: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not document_ids:
        return grouped
    result = await session.execute(
        select(document_column, id_column).where(document_column.in_(document_ids))
    )
    for document_id, value in result.tuples():
        grouped[document_id].append(value)
    return grouped


def _document_from_row(row: DocumentRow) -> Document:
    return Document(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        description=row.description,
        visibility=DocumentVisibility(row.visibility),
        created_by=row.created_by,
    )


async def insert_new_document(
    session: AsyncSession,
    plan: NewDocumentPlan,
    tag_ids: Sequence[uuid.UUID],
    selective_user_ids: Sequence[uuid.UUID],
) -> None:
    session.add(
        DocumentRow(
            id=plan.document.id,
            room_id=plan.document.room_id,
            name=plan.document.name,
            description=plan.document.description,
            visibility=plan.document.visibility.value,
            created_by=plan.document.created_by,
        )
    )
    await session.flush()

    session.add(DocumentOwnerRow(document_id=plan.owner.document_id, user_id=plan.owner.user_id))
    for tag_id in tag_ids:
        session.add(DocumentTagRow(document_id=plan.document.id, tag_id=tag_id))
    for user_id in selective_user_ids:
        session.add(DocumentVisibilityGrantRow(document_id=plan.document.id, user_id=user_id))
    await session.flush()


async def get_document(session: AsyncSession, document_id: uuid.UUID) -> Document | None:
    row = await session.get(DocumentRow, document_id)
    return _document_from_row(row) if row else None


async def list_documents_for_room(session: AsyncSession, room_id: uuid.UUID) -> list[Document]:
    result = await session.execute(select(DocumentRow).where(DocumentRow.room_id == room_id))
    return [_document_from_row(row) for row in result.scalars()]


async def update_document(session: AsyncSession, document: Document) -> None:
    row = await session.get(DocumentRow, document.id)
    if row is None:
        raise LookupError(f"Document {document.id} not found")
    row.name = document.name
    row.description = document.description
    row.visibility = document.visibility.value
    await session.flush()


def _image_from_row(row: DocumentImageRow) -> DocumentImage:
    return DocumentImage(
        id=row.id,
        document_id=row.document_id,
        storage_path=row.storage_path,
        created_by=row.created_by,
        post_id=row.post_id,
        is_favorite=row.is_favorite,
    )


# The Document's favorite leads the gallery, the rest stay in upload order
# (spec 07), so the card and the detail page agree on which image comes first.
_GALLERY_ORDER = (
    DocumentImageRow.is_favorite.desc(),
    DocumentImageRow.created_at,
    DocumentImageRow.id,
)


async def lock_document(session: AsyncSession, document_id: uuid.UUID) -> None:
    """Row lock held until the transaction ends: serializes concurrent image
    additions to one Document, so a count-then-insert can't overshoot the
    image limits."""
    await session.execute(
        select(DocumentRow.id).where(DocumentRow.id == document_id).with_for_update()
    )


async def list_images(session: AsyncSession, document_id: uuid.UUID) -> list[DocumentImage]:
    result = await session.execute(
        select(DocumentImageRow)
        .where(DocumentImageRow.document_id == document_id)
        .order_by(*_GALLERY_ORDER)
    )
    return [_image_from_row(row) for row in result.scalars()]


async def list_images_for_documents(
    session: AsyncSession, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[DocumentImage]]:
    """`list_images` for many Documents in one query, so the Documents list
    doesn't fan out per card. Each Document keeps `list_images`' order."""
    by_document: dict[uuid.UUID, list[DocumentImage]] = defaultdict(list)
    if not document_ids:
        return by_document
    result = await session.execute(
        select(DocumentImageRow)
        .where(DocumentImageRow.document_id.in_(document_ids))
        .order_by(*_GALLERY_ORDER)
    )
    for row in result.scalars():
        by_document[row.document_id].append(_image_from_row(row))
    return by_document


async def insert_image(session: AsyncSession, image: DocumentImage) -> None:
    session.add(
        DocumentImageRow(
            id=image.id,
            document_id=image.document_id,
            storage_path=image.storage_path,
            created_by=image.created_by,
            post_id=image.post_id,
            is_favorite=image.is_favorite,
        )
    )
    await session.flush()


async def list_images_for_posts(
    session: AsyncSession, post_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[DocumentImage]]:
    by_post: dict[uuid.UUID, list[DocumentImage]] = defaultdict(list)
    if not post_ids:
        return by_post
    result = await session.execute(
        select(DocumentImageRow)
        .where(DocumentImageRow.post_id.in_(post_ids))
        .order_by(DocumentImageRow.created_at, DocumentImageRow.id)
    )
    for row in result.scalars():
        assert row.post_id is not None
        by_post[row.post_id].append(_image_from_row(row))
    return by_post


async def set_favorite_image(
    session: AsyncSession, document_id: uuid.UUID, image_id: uuid.UUID
) -> None:
    """Moves the favorite flag to `image_id` (spec 07: only one at a time).
    The previous favorite is cleared and flushed first - the partial unique
    index would otherwise reject the instant both rows are true.

    Takes the Document's lock first, like every other write that depends on
    which images it currently has. Two concurrent moves would otherwise both
    clear and both set: the second one's clear matches nothing (the first
    already flipped the old favorite), so its insert of a second `true` hits
    the unique index and the request dies with an IntegrityError."""
    await lock_document(session, document_id)
    await session.execute(
        update(DocumentImageRow)
        .where(
            DocumentImageRow.document_id == document_id,
            DocumentImageRow.is_favorite,
            DocumentImageRow.id != image_id,
        )
        .values(is_favorite=False)
    )
    await session.flush()
    await session.execute(
        update(DocumentImageRow).where(DocumentImageRow.id == image_id).values(is_favorite=True)
    )
    await session.flush()


async def delete_images(session: AsyncSession, image_ids: Sequence[uuid.UUID]) -> None:
    if image_ids:
        await session.execute(delete(DocumentImageRow).where(DocumentImageRow.id.in_(image_ids)))
        await session.flush()


async def delete_image(session: AsyncSession, image_id: uuid.UUID) -> None:
    await session.execute(delete(DocumentImageRow).where(DocumentImageRow.id == image_id))
    await session.flush()


async def list_owner_ids(session: AsyncSession, document_id: uuid.UUID) -> list[uuid.UUID]:
    result = await session.execute(
        select(DocumentOwnerRow.user_id).where(DocumentOwnerRow.document_id == document_id)
    )
    return list(result.scalars())


async def list_owner_ids_for_documents(
    session: AsyncSession, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """`list_owner_ids` for many Documents in one query."""
    return await _ids_by_document(
        session, DocumentOwnerRow.document_id, DocumentOwnerRow.user_id, document_ids
    )


async def insert_owner(session: AsyncSession, document_id: uuid.UUID, user_id: uuid.UUID) -> None:
    session.add(DocumentOwnerRow(document_id=document_id, user_id=user_id))
    await session.flush()


async def delete_owner(session: AsyncSession, document_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await session.execute(
        delete(DocumentOwnerRow).where(
            DocumentOwnerRow.document_id == document_id, DocumentOwnerRow.user_id == user_id
        )
    )
    await session.flush()


async def list_selective_grant_ids(
    session: AsyncSession, document_id: uuid.UUID
) -> list[uuid.UUID]:
    result = await session.execute(
        select(DocumentVisibilityGrantRow.user_id).where(
            DocumentVisibilityGrantRow.document_id == document_id
        )
    )
    return list(result.scalars())


async def list_selective_grant_ids_for_documents(
    session: AsyncSession, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """`list_selective_grant_ids` for many Documents in one query."""
    return await _ids_by_document(
        session,
        DocumentVisibilityGrantRow.document_id,
        DocumentVisibilityGrantRow.user_id,
        document_ids,
    )


async def set_selective_grants(
    session: AsyncSession, document_id: uuid.UUID, user_ids: Sequence[uuid.UUID]
) -> None:
    await session.execute(
        delete(DocumentVisibilityGrantRow).where(
            DocumentVisibilityGrantRow.document_id == document_id
        )
    )
    for user_id in user_ids:
        session.add(DocumentVisibilityGrantRow(document_id=document_id, user_id=user_id))
    await session.flush()


async def list_tag_ids_for_document(
    session: AsyncSession, document_id: uuid.UUID
) -> list[uuid.UUID]:
    result = await session.execute(
        select(DocumentTagRow.tag_id).where(DocumentTagRow.document_id == document_id)
    )
    return list(result.scalars())


async def list_tag_ids_for_documents(
    session: AsyncSession, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """`list_tag_ids_for_document` for many Documents in one query."""
    return await _ids_by_document(
        session, DocumentTagRow.document_id, DocumentTagRow.tag_id, document_ids
    )


async def set_document_tags(
    session: AsyncSession, document_id: uuid.UUID, tag_ids: Sequence[uuid.UUID]
) -> None:
    await session.execute(delete(DocumentTagRow).where(DocumentTagRow.document_id == document_id))
    for tag_id in tag_ids:
        session.add(DocumentTagRow(document_id=document_id, tag_id=tag_id))
    await session.flush()

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    DocumentImageRow,
    DocumentOwnerRow,
    DocumentRow,
    DocumentTagRow,
    DocumentVisibilityGrantRow,
)
from app.domain.documents import NewDocumentPlan
from app.domain.models import Document, DocumentImage, DocumentVisibility


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
    )


async def list_images(session: AsyncSession, document_id: uuid.UUID) -> list[DocumentImage]:
    result = await session.execute(
        select(DocumentImageRow)
        .where(DocumentImageRow.document_id == document_id)
        .order_by(DocumentImageRow.created_at, DocumentImageRow.id)
    )
    return [_image_from_row(row) for row in result.scalars()]


async def insert_image(session: AsyncSession, image: DocumentImage) -> None:
    session.add(
        DocumentImageRow(
            id=image.id,
            document_id=image.document_id,
            storage_path=image.storage_path,
            created_by=image.created_by,
            post_id=image.post_id,
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


async def set_document_tags(
    session: AsyncSession, document_id: uuid.UUID, tag_ids: Sequence[uuid.UUID]
) -> None:
    await session.execute(delete(DocumentTagRow).where(DocumentTagRow.document_id == document_id))
    for tag_id in tag_ids:
        session.add(DocumentTagRow(document_id=document_id, tag_id=tag_id))
    await session.flush()

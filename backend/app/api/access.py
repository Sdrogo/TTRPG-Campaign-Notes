"""Access checks shared by the routers that sit under a Room/Document
(documents, comments), so each applies them the same way."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import comments_repo, documents_repo, rooms_repo
from app.domain.models import Document, DocumentImage, Membership, RoomRole
from app.domain.visibility import is_document_visible, visible_document_images


async def require_membership(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID
) -> Membership:
    membership = await rooms_repo.get_membership(session, room_id, user_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")
    return membership


async def get_visible_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    requester_id: uuid.UUID,
    role: RoomRole,
) -> tuple[Document, list[uuid.UUID], list[uuid.UUID]]:
    """Returns (document, owner_ids, selective_ids) once the requester is
    known to see it."""
    document = await documents_repo.get_document(session, document_id)
    if document is None or document.room_id != room_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    owner_ids = await documents_repo.list_owner_ids(session, document_id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document_id)
    if not is_document_visible(document, requester_id, role, owner_ids, selective_ids):
        # Not found, not forbidden - a Document you can't see doesn't
        # exist as far as you're concerned (VR-07).
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")

    return document, owner_ids, selective_ids


async def get_visible_images(
    session: AsyncSession, document_id: uuid.UUID, viewer: Membership
) -> list[DocumentImage]:
    """A Document's images as this viewer may see them: Comment attachments
    only when the viewer can read that Comment (Invariant 1)."""
    images = await documents_repo.list_images(session, document_id)
    post_ids = list({image.post_id for image in images if image.post_id is not None})
    comments = await comments_repo.get_comments_by_ids(session, post_ids)
    grants = await comments_repo.list_grants_for_comments(session, post_ids)
    return visible_document_images(images, comments, grants, viewer.user_id, viewer.role)

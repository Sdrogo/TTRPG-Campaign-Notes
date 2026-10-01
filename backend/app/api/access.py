"""Access checks shared by the routers that sit under a Room/Document
(documents, comments, notes, document files), so each applies them the same
way."""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import http_error, translated_error
from app.db import comments_repo, documents_repo, notes_repo, rooms_repo
from app.domain.documents import NotOwnerError, ensure_owner
from app.domain.models import Document, DocumentImage, Membership, Note, RoomRole
from app.domain.visibility import is_document_visible, is_note_visible, visible_document_images


async def require_membership(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> Membership:
    """The caller's Membership in the Room, or 403 when they aren't a member.
    Every Room-scoped route starts here, since roles are per Room (D-06)."""
    membership = await rooms_repo.get_membership(session, room_id, user_id)
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)
    return membership


async def get_visible_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    requester_id: uuid.UUID,
    role: RoomRole,
    locale: str,
) -> tuple[Document, list[uuid.UUID], list[uuid.UUID]]:
    """Returns (document, owner_ids, selective_ids) once the requester is
    known to see it."""
    document = await documents_repo.get_document(session, document_id)
    if document is None or document.room_id != room_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.document.notFound", locale)

    owner_ids = await documents_repo.list_owner_ids(session, document_id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document_id)
    if not is_document_visible(document, requester_id, role, owner_ids, selective_ids):
        # Not found, not forbidden - a Document you can't see doesn't
        # exist as far as you're concerned (VR-07).
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.document.notFound", locale)

    return document, owner_ids, selective_ids


async def get_owned_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    requester_id: uuid.UUID,
    locale: str,
) -> tuple[Document, list[uuid.UUID], Membership]:
    """Returns (document, owner_ids, membership) once the requester is known
    to see the Document (404 otherwise, VR-07) and to be one of its Owners or
    the Master (403 otherwise, D-12) - visibility first, so the status can't
    reveal a hidden Document."""
    membership = await require_membership(session, room_id, requester_id, locale)
    document, owner_ids, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role, locale
    )
    try:
        ensure_owner(membership.role, requester_id, owner_ids)
    except NotOwnerError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    return document, owner_ids, membership


async def ensure_room_members(
    session: AsyncSession,
    room_id: uuid.UUID,
    user_ids: Collection[uuid.UUID],
    error_key: str,
    locale: str,
) -> None:
    """422 (with `error_key`) unless every one of `user_ids` is a member of the
    Room - a Selective grant can't name an outsider."""
    member_ids = {m.user_id for m in await rooms_repo.list_memberships(session, room_id)}
    if not set(user_ids) <= member_ids:
        raise http_error(status.HTTP_422_UNPROCESSABLE_CONTENT, error_key, locale)


@dataclass(frozen=True)
class DocumentNotes:
    """A Document's Notes: every one (for the cap, the order and the position
    of a new one) and the ones this viewer may see, with their grants."""

    every: list[Note]
    visible: list[Note]
    grants: dict[uuid.UUID, list[uuid.UUID]]


async def get_document_notes(
    session: AsyncSession,
    document_id: uuid.UUID,
    viewer: Membership,
    document_owner_ids: Collection[uuid.UUID],
) -> DocumentNotes:
    """A Document's Notes as this viewer may see them (Invariant 1, VR-07): a
    Note they can't read is simply absent from `visible`, in two queries
    whatever the number of Notes. The caller already knows the viewer sees the
    Document itself."""
    every = await notes_repo.list_notes_for_document(session, document_id)
    grants = await notes_repo.list_grants_for_notes(session, [note.id for note in every])
    visible = [
        note
        for note in every
        if is_note_visible(note, viewer.user_id, viewer.role, document_owner_ids, grants[note.id])
    ]
    return DocumentNotes(every=every, visible=visible, grants=grants)


async def _filter_images(
    session: AsyncSession, images: list[DocumentImage], viewer: Membership
) -> list[DocumentImage]:
    """Applies the Comment-inheritance filter to images already read from
    the DB, in two queries whatever their Document."""
    post_ids = list({image.post_id for image in images if image.post_id is not None})
    comments = await comments_repo.get_comments_by_ids(session, post_ids)
    grants = await comments_repo.list_grants_for_comments(session, post_ids)
    return visible_document_images(images, comments, grants, viewer.user_id, viewer.role)


async def get_visible_images(
    session: AsyncSession, document_id: uuid.UUID, viewer: Membership
) -> list[DocumentImage]:
    """A Document's images as this viewer may see them: Comment attachments
    only when the viewer can read that Comment (Invariant 1)."""
    images = await documents_repo.list_images(session, document_id)
    return await _filter_images(session, images, viewer)


async def get_visible_images_for_documents(
    session: AsyncSession, document_ids: Sequence[uuid.UUID], viewer: Membership
) -> dict[uuid.UUID, list[DocumentImage]]:
    """`get_visible_images` for many Documents, in a fixed number of queries
    rather than three per Document - the Documents list shows every card's
    images, so it reads them for the whole page at once. Same filter, so a
    Comment attachment the viewer can't read is left out here too
    (Invariant 1)."""
    by_document = await documents_repo.list_images_for_documents(session, document_ids)
    all_images = [image for images in by_document.values() for image in images]
    visible_ids = {image.id for image in await _filter_images(session, all_images, viewer)}
    return {
        document_id: [image for image in images if image.id in visible_ids]
        for document_id, images in by_document.items()
    }

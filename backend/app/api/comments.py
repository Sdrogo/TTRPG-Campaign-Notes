import uuid
from collections.abc import Collection, Mapping
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_document, require_membership
from app.api.image_uploads import (
    ImageResponse,
    ensure_room_for_another_image,
    fetch_url,
    image_responses,
    read_upload,
    remove_images,
    sign_images,
    store_image,
)
from app.auth.dependencies import CurrentUserDep
from app.db import comments_repo, documents_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.comments import (
    CannotDeleteCommentError,
    CommentBodyRequiredError,
    CommentDeletedError,
    CommentTooLongError,
    NotCommentAuthorError,
    TooManyCommentImagesError,
    can_delete_comment,
    can_edit_comment,
    ensure_can_attach_image,
    ensure_can_detach_image,
    plan_comment_deletion,
    plan_comment_edit,
    plan_new_comment,
)
from app.domain.models import Comment, Document, DocumentImage, DocumentVisibility, Membership
from app.domain.visibility import is_comment_visible

router = APIRouter(prefix="/rooms/{room_id}/documents/{document_id}/comments", tags=["comments"])


class CommentResponse(BaseModel):
    id: uuid.UUID
    document_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    visibility: DocumentVisibility
    selective_user_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime
    deleted: bool
    # Attached images. They're also Document images (shown in its gallery),
    # with this Comment's visibility.
    images: list[ImageResponse]
    # What the requester may do with this Comment, decided by the domain
    # layer so the UI never re-derives permission rules.
    can_edit: bool
    can_delete: bool


class CreateCommentRequest(BaseModel):
    body: str
    visibility: DocumentVisibility = DocumentVisibility.ROOM
    selective_user_ids: list[uuid.UUID] = []


class ImageFromUrlRequest(BaseModel):
    url: HttpUrl


class UpdateCommentRequest(BaseModel):
    body: str | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: list[uuid.UUID] | None = None


def _to_response(
    comment: Comment,
    selective_ids: Collection[uuid.UUID],
    images: Collection[DocumentImage],
    image_urls: Mapping[str, str],
    viewer: Membership,
) -> CommentResponse:
    return CommentResponse(
        id=comment.id,
        document_id=comment.document_id,
        author_id=comment.author_id,
        body=comment.body,
        visibility=comment.visibility,
        selective_user_ids=sorted(selective_ids),
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        deleted=comment.deleted_at is not None,
        images=image_responses(images, image_urls),
        can_edit=can_edit_comment(comment, viewer.user_id),
        can_delete=can_delete_comment(comment, viewer.user_id, viewer.role),
    )


def _body_error(exc: Exception) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))


async def _validate_grantees(
    session: AsyncSession, room_id: uuid.UUID, user_ids: Collection[uuid.UUID]
) -> None:
    member_ids = {m.user_id for m in await rooms_repo.list_memberships(session, room_id)}
    if not set(user_ids) <= member_ids:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "selective_user_ids must all be members of this room",
        )


async def _get_visible_comment(
    session: AsyncSession, document_id: uuid.UUID, comment_id: uuid.UUID, viewer: Membership
) -> tuple[Comment, list[uuid.UUID]]:
    comment = await comments_repo.get_comment(session, comment_id)
    if comment is None or comment.document_id != document_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    selective_ids = (await comments_repo.list_grants_for_comments(session, [comment.id]))[
        comment.id
    ]
    if not is_comment_visible(comment, viewer.user_id, viewer.role, selective_ids):
        # Same as Documents: hidden content doesn't reveal it exists (VR-07).
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    return comment, selective_ids


async def _require_visible_document(
    session: AsyncSession, room_id: uuid.UUID, document_id: uuid.UUID, requester_id: uuid.UUID
) -> tuple[Membership, Document]:
    membership = await require_membership(session, room_id, requester_id)
    document, _, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role
    )
    return membership, document


async def _comment_images(session: AsyncSession, comment_id: uuid.UUID) -> list[DocumentImage]:
    return (await documents_repo.list_images_for_posts(session, [comment_id]))[comment_id]


def _author_error(
    exc: NotCommentAuthorError | CommentDeletedError | TooManyCommentImagesError,
) -> HTTPException:
    if isinstance(exc, NotCommentAuthorError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    return HTTPException(status.HTTP_409_CONFLICT, str(exc))


@router.get("")
async def list_comments(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> list[CommentResponse]:
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(session, room_id, document_id, requester_id)

    comments = await comments_repo.list_comments_for_document(session, document_id)
    comment_ids = [c.id for c in comments]
    grants = await comments_repo.list_grants_for_comments(session, comment_ids)
    images = await documents_repo.list_images_for_posts(session, comment_ids)
    image_urls = await sign_images(image for group in images.values() for image in group)
    return [
        _to_response(comment, grants[comment.id], images[comment.id], image_urls, membership)
        for comment in comments
        if is_comment_visible(comment, requester_id, membership.role, grants[comment.id])
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: CreateCommentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> CommentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(session, room_id, document_id, requester_id)

    try:
        comment = plan_new_comment(
            document_id, requester_id, body.body, body.visibility, datetime.now(UTC)
        )
    except (CommentBodyRequiredError, CommentTooLongError) as exc:
        raise _body_error(exc) from exc

    await _validate_grantees(session, room_id, body.selective_user_ids)
    await comments_repo.insert_comment(session, comment, body.selective_user_ids)
    return _to_response(comment, set(body.selective_user_ids), [], {}, membership)


@router.patch("/{comment_id}")
async def update_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: UpdateCommentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> CommentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(session, room_id, document_id, requester_id)
    comment, selective_ids = await _get_visible_comment(
        session, document_id, comment_id, membership
    )

    try:
        plan = plan_comment_edit(
            comment,
            room_id,
            requester_id,
            datetime.now(UTC),
            body=body.body,
            visibility=body.visibility,
            current_selective_ids=selective_ids,
            new_selective_ids=body.selective_user_ids,
        )
    except (NotCommentAuthorError, CommentDeletedError) as exc:
        raise _author_error(exc) from exc
    except (CommentBodyRequiredError, CommentTooLongError) as exc:
        raise _body_error(exc) from exc

    if body.selective_user_ids is not None:
        await _validate_grantees(session, room_id, body.selective_user_ids)

    await comments_repo.update_comment(session, plan.comment)
    if body.selective_user_ids is not None:
        await comments_repo.set_comment_grants(session, comment_id, body.selective_user_ids)
        selective_ids = list(set(body.selective_user_ids))
    if plan.audit_entry is not None:
        await rooms_repo.insert_audit_log(session, plan.audit_entry)

    images = await _comment_images(session, comment_id)
    return _to_response(plan.comment, selective_ids, images, await sign_images(images), membership)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(session, room_id, document_id, requester_id)
    comment, _ = await _get_visible_comment(session, document_id, comment_id, membership)

    try:
        deleted = plan_comment_deletion(comment, requester_id, membership.role, datetime.now(UTC))
    except CannotDeleteCommentError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except CommentDeletedError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    # A deleted Comment's images go too - they'd otherwise outlive the
    # Comment in the Document gallery (moderation must actually remove them).
    await remove_images(session, await _comment_images(session, comment_id))
    await comments_repo.update_comment(session, deleted)


async def _attach_image(
    session: AsyncSession,
    membership: Membership,
    document: Document,
    comment_id: uuid.UUID,
    source: UploadFile | str,
) -> CommentResponse:
    """Attaches one image (an uploaded file, or a URL to import) to a
    Comment. It becomes a Document image too, linked to the Comment."""
    comment, selective_ids = await _get_visible_comment(
        session, document.id, comment_id, membership
    )
    # Locks the Document first, so the Comment's own count below can't race
    # a concurrent attachment either.
    document_images = await ensure_room_for_another_image(session, document)
    images = await _comment_images(session, comment_id)
    try:
        ensure_can_attach_image(comment, membership.user_id, len(images))
    except (NotCommentAuthorError, CommentDeletedError, TooManyCommentImagesError) as exc:
        raise _author_error(exc) from exc

    data = await fetch_url(source) if isinstance(source, str) else await read_upload(source)
    image = await store_image(
        session, document, membership.user_id, data, document_images, post_id=comment.id
    )
    all_images = [*images, image]
    return _to_response(
        comment, selective_ids, all_images, await sign_images(all_images), membership
    )


@router.post("/{comment_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_comment_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> CommentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership, document = await _require_visible_document(
        session, room_id, document_id, requester_id
    )
    return await _attach_image(session, membership, document, comment_id, file)


@router.post("/{comment_id}/images/from-url", status_code=status.HTTP_201_CREATED)
async def import_comment_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: ImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> CommentResponse:
    requester_id = uuid.UUID(current_user.id)
    membership, document = await _require_visible_document(
        session, room_id, document_id, requester_id
    )
    return await _attach_image(session, membership, document, comment_id, str(body.url))


@router.delete("/{comment_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(session, room_id, document_id, requester_id)
    comment, _ = await _get_visible_comment(session, document_id, comment_id, membership)
    try:
        ensure_can_detach_image(comment, requester_id)
    except (NotCommentAuthorError, CommentDeletedError) as exc:
        raise _author_error(exc) from exc

    image = next((i for i in await _comment_images(session, comment_id) if i.id == image_id), None)
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    await remove_images(session, [image])

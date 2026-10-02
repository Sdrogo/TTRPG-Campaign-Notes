"""Comments on a Document's main Thread (D-20, FR-T1, FR-T5). A Comment is
reachable only through a Document the requester can see, and is then filtered
by its effective visibility: its own (VR-03) and, for a reply, that of every
Comment above it (spec 19, D-17)."""

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import ensure_room_members, get_visible_document, require_membership
from app.api.characters import CharacterResponse, visible_characters
from app.api.errors import http_error, translated_error
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
from app.domain.characters import CannotPostAsError, character_shown_to, ensure_can_post_as
from app.domain.comments import (
    CannotDeleteCommentError,
    CommentBodyRequiredError,
    CommentDeletedError,
    CommentTooLongError,
    NotCommentAuthorError,
    ParentCommentDeletedError,
    ReplyWiderThanParentError,
    TooManyCommentImagesError,
    can_delete_comment,
    can_edit_comment,
    ensure_can_attach_image,
    ensure_can_detach_image,
    ensure_not_wider,
    plan_comment_deletion,
    plan_comment_edit,
    plan_new_comment,
)
from app.domain.errors import DomainError
from app.domain.models import Comment, Document, DocumentImage, DocumentVisibility, Membership
from app.domain.visibility import (
    is_comment_visible_in_thread,
    is_document_visible,
    is_parent_hidden,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/documents/{document_id}/comments", tags=["comments"])


class CommentResponse(BaseModel):
    """A Comment as every route serializes it. A deleted Comment keeps its
    place with an empty body and `deleted` set (FR-T5)."""

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
    # The Character the Comment was written as (D-24), only when this viewer
    # sees that Document; otherwise None and the author shows as usual
    # (VR-13). `author_id` is always the real author.
    as_character: CharacterResponse | None
    # The Comment this one answers (spec 19), None for a top-level Comment.
    # The list is flat: the client builds the tree from it.
    parent_id: uuid.UUID | None
    # True when this is a reply whose parent the viewer can't see. Only its
    # own author gets one (Decision 6); `parent_id` is then withheld, so the
    # client draws a placeholder that reveals nothing about the parent.
    parent_hidden: bool


class CreateCommentRequest(BaseModel):
    """A new Comment with its visibility level, for Selective who else may
    read it, optionally the Character it is written as (D-24), and the
    Comment it answers (spec 19)."""

    body: str
    visibility: DocumentVisibility = DocumentVisibility.ROOM
    selective_user_ids: list[uuid.UUID] = []
    as_document_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None


class ImageFromUrlRequest(BaseModel):
    """An image to attach from a URL instead of uploading a file."""

    url: HttpUrl


class UpdateCommentRequest(BaseModel):
    """A partial edit: omitted fields are left as they are. Changing the
    visibility or the grants is audited (VR-08). `as_document_id` sent as null
    turns a Comment written as a Character back into a plain one."""

    body: str | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: list[uuid.UUID] | None = None
    as_document_id: uuid.UUID | None = None


@dataclass(frozen=True)
class _Thread:
    """Comments of one Document with their Selective grants, keyed by id:
    enough to decide a Comment's effective visibility (spec 19)."""

    comments: Mapping[uuid.UUID, Comment]
    grants: Mapping[uuid.UUID, Collection[uuid.UUID]]

    def is_visible(self, comment: Comment, viewer: Membership) -> bool:
        """Whether `viewer` sees `comment` on its own and through its parents."""
        return is_comment_visible_in_thread(
            comment, self.comments, self.grants, viewer.user_id, viewer.role
        )

    def parent_hidden(self, comment: Comment, viewer: Membership) -> bool:
        """Whether `comment` answers a Comment `viewer` can't see."""
        return is_parent_hidden(comment, self.comments, self.grants, viewer.user_id, viewer.role)


async def _thread_around(session: AsyncSession, comment_ids: Collection[uuid.UUID]) -> _Thread:
    """The Comments with these ids and every Comment above them, with grants."""
    comments = await comments_repo.get_comments_with_ancestors(session, list(comment_ids))
    grants = await comments_repo.list_grants_for_comments(session, list(comments))
    return _Thread(comments=comments, grants=grants)


def _to_response(
    comment: Comment,
    selective_ids: Collection[uuid.UUID],
    images: Collection[DocumentImage],
    image_urls: Mapping[str, str],
    viewer: Membership,
    characters: Mapping[uuid.UUID, CharacterResponse],
    parent_hidden: bool = False,
) -> CommentResponse:
    """Serializes a Comment for `viewer`, with the permission flags the UI
    shows or hides its actions by. `characters` holds only the Characters the
    viewer sees (`visible_characters`). With `parent_hidden`, `parent_id` is
    withheld (spec 19 Decision 6)."""
    character_id = character_shown_to(comment, characters.keys())
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
        as_character=None if character_id is None else characters[character_id],
        parent_id=None if parent_hidden else comment.parent_id,
        parent_hidden=parent_hidden,
    )


async def _characters_for(
    session: AsyncSession, comments: Collection[Comment], viewer: Membership
) -> Mapping[uuid.UUID, CharacterResponse]:
    """The Characters these Comments were written as, those `viewer` may see
    (VR-13)."""
    ids = {c.as_document_id for c in comments if c.as_document_id is not None}
    return await visible_characters(session, ids, viewer)


async def _ensure_can_post_as(
    session: AsyncSession, author: Membership, document_id: uuid.UUID, locale: str
) -> None:
    """UC-22: the Character must be a Document of the author's Room that they
    see (404 otherwise, whether or not it exists, VR-07), and one they may
    write as (403, D-24) - visibility first, so the status can't reveal a
    hidden Document."""
    found = await documents_repo.get_documents_by_ids(session, [document_id])
    document = found[0] if found else None
    if document is None or document.room_id != author.room_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.character.notFound", locale)
    owner_ids = await documents_repo.list_owner_ids(session, document_id)
    selective_ids = await documents_repo.list_selective_grant_ids(session, document_id)
    if not is_document_visible(document, author.user_id, author.role, owner_ids, selective_ids):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.character.notFound", locale)
    try:
        ensure_can_post_as(document, author.user_id, author.role)
    except CannotPostAsError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc


def _body_error(exc: DomainError, locale: str) -> HTTPException:
    """The 422 for a Comment body that is empty or too long."""
    return translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale)


async def _validate_grantees(
    session: AsyncSession, room_id: uuid.UUID, user_ids: Collection[uuid.UUID], locale: str
) -> None:
    """422 unless every Selective grantee is a member of the Room."""
    await ensure_room_members(
        session, room_id, user_ids, "errors.comment.invalidSelectiveUsers", locale
    )


@dataclass(frozen=True)
class _VisibleComment:
    """A Comment the viewer is known to see, with what its routes need."""

    comment: Comment
    selective_ids: list[uuid.UUID]
    thread: _Thread


async def _get_visible_comment(
    session: AsyncSession,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    viewer: Membership,
    locale: str,
    not_found_key: str = "errors.comment.notFound",
) -> _VisibleComment:
    """The Comment once the viewer is known to see it, through its parents
    too (spec 19); 404 otherwise, whether or not it exists (VR-07)."""
    thread = await _thread_around(session, [comment_id])
    comment = thread.comments.get(comment_id)
    if (
        comment is None
        or comment.document_id != document_id
        or not thread.is_visible(comment, viewer)
    ):
        # Same as Documents: hidden content doesn't reveal it exists (VR-07).
        raise http_error(status.HTTP_404_NOT_FOUND, not_found_key, locale)
    return _VisibleComment(
        comment=comment, selective_ids=list(thread.grants[comment.id]), thread=thread
    )


async def _ensure_not_wider(
    session: AsyncSession,
    room_id: uuid.UUID,
    author_id: uuid.UUID,
    visibility: DocumentVisibility,
    selective_ids: Collection[uuid.UUID],
    parent: Comment,
    thread: _Thread,
    locale: str,
) -> None:
    """422 when a reply would reach a member who can't read its parent
    (VR-04, spec 19 Decision 2)."""
    members = await rooms_repo.list_memberships(session, room_id)
    try:
        ensure_not_wider(
            author_id, visibility, selective_ids, parent, thread.grants[parent.id], members
        )
    except ReplyWiderThanParentError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc


async def _require_visible_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    requester_id: uuid.UUID,
    locale: str,
) -> tuple[Membership, Document]:
    """The requester's Membership and the Document, once they are known to be a
    member who can see it."""
    membership = await require_membership(session, room_id, requester_id, locale)
    document, _, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role, locale
    )
    return membership, document


async def _comment_images(session: AsyncSession, comment_id: uuid.UUID) -> list[DocumentImage]:
    """The images attached to one Comment."""
    return (await documents_repo.list_images_for_posts(session, [comment_id]))[comment_id]


def _author_error(
    exc: NotCommentAuthorError | CommentDeletedError | TooManyCommentImagesError, locale: str
) -> HTTPException:
    """403 for a non-author, 409 for a deleted Comment or one that is already
    at its image limit."""
    if isinstance(exc, NotCommentAuthorError):
        return translated_error(status.HTTP_403_FORBIDDEN, exc, locale)
    return translated_error(status.HTTP_409_CONFLICT, exc, locale)


@router.get("")
async def list_comments(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[CommentResponse]:
    """The Document's Comments the requester can see, deleted placeholders
    included (FR-T5), as a flat list oldest first: each reply carries its
    `parent_id` and the client builds the tree (spec 19). A reply is listed
    only when the requester also sees every Comment above it, except to its
    own author (`parent_hidden`)."""
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )

    comments = await comments_repo.list_comments_for_document(session, document_id)
    comment_ids = [c.id for c in comments]
    grants = await comments_repo.list_grants_for_comments(session, comment_ids)
    thread = _Thread(comments={c.id: c for c in comments}, grants=grants)
    visible = [comment for comment in comments if thread.is_visible(comment, membership)]
    # Images and Characters are read only for the Comments that survived the
    # filter.
    images = await documents_repo.list_images_for_posts(session, [c.id for c in visible])
    image_urls = await sign_images(image for group in images.values() for image in group)
    characters = await _characters_for(session, visible, membership)
    return [
        _to_response(
            comment,
            grants[comment.id],
            images[comment.id],
            image_urls,
            membership,
            characters,
            parent_hidden=thread.parent_hidden(comment, membership),
        )
        for comment in visible
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    body: CreateCommentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """UC-11: any member who can see the Document comments on it, choosing the
    Comment's visibility (VR-02). With `as_document_id` it is written as a
    Character (UC-22): one the author plays, or any Document for the Master
    (D-24); 403 otherwise, 404 for a Document they can't see. With
    `parent_id` it answers that Comment (spec 19): 404 if it isn't one of
    this Document's Comments the author sees, 409 if it was deleted, 422 if
    the reply would reach someone who can't read it (VR-04)."""
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )

    parent = None
    if body.parent_id is not None:
        parent = await _get_visible_comment(
            session,
            document_id,
            body.parent_id,
            membership,
            locale,
            not_found_key="errors.comment.parentNotFound",
        )
    try:
        comment = plan_new_comment(
            document_id,
            requester_id,
            body.body,
            body.visibility,
            datetime.now(UTC),
            as_document_id=body.as_document_id,
            parent=None if parent is None else parent.comment,
        )
    except (CommentBodyRequiredError, CommentTooLongError) as exc:
        raise _body_error(exc, locale) from exc
    except ParentCommentDeletedError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
    # ParentCommentNotFoundError can't happen here: `_get_visible_comment`
    # already answered 404 for a Comment of another Document.

    if body.as_document_id is not None:
        await _ensure_can_post_as(session, membership, body.as_document_id, locale)
    await _validate_grantees(session, room_id, body.selective_user_ids, locale)
    if parent is not None:
        await _ensure_not_wider(
            session,
            room_id,
            requester_id,
            body.visibility,
            body.selective_user_ids,
            parent.comment,
            parent.thread,
            locale,
        )
    await comments_repo.insert_comment(session, comment, body.selective_user_ids)
    characters = await _characters_for(session, [comment], membership)
    return _to_response(comment, set(body.selective_user_ids), [], {}, membership, characters)


@router.patch("/{comment_id}")
async def update_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: UpdateCommentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T5: the author edits their Comment's body, visibility, grants or the
    Character it is written as (same rule as creating one, D-24). A change of
    who can see it is audited in the same transaction (VR-08, Invariant 7).
    A reply's new audience must still fit inside its parent's, 422 otherwise
    (VR-04, spec 19); editing only the body never re-checks it."""
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    found = await _get_visible_comment(session, document_id, comment_id, membership, locale)
    comment, selective_ids = found.comment, found.selective_ids

    change_character = "as_document_id" in body.model_fields_set
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
            change_character=change_character,
            as_document_id=body.as_document_id,
        )
    except (NotCommentAuthorError, CommentDeletedError) as exc:
        raise _author_error(exc, locale) from exc
    except (CommentBodyRequiredError, CommentTooLongError) as exc:
        raise _body_error(exc, locale) from exc

    # Re-checked only for a new Character: re-sending the current one is not a
    # change, even if the author no longer plays it.
    if (
        change_character
        and body.as_document_id is not None
        and body.as_document_id != comment.as_document_id
    ):
        await _ensure_can_post_as(session, membership, body.as_document_id, locale)

    if body.selective_user_ids is not None:
        await _validate_grantees(session, room_id, body.selective_user_ids, locale)

    # Only an edit that changes who sees the reply is checked (the same edits
    # that are audited), so a reply whose parent was narrowed after it was
    # written can still have its body corrected.
    if comment.parent_id is not None and plan.audit_entry is not None:
        await _ensure_not_wider(
            session,
            room_id,
            requester_id,
            plan.comment.visibility,
            selective_ids if body.selective_user_ids is None else body.selective_user_ids,
            # `_get_visible_comment` loaded every Comment above this one.
            found.thread.comments[comment.parent_id],
            found.thread,
            locale,
        )

    await comments_repo.update_comment(session, plan.comment)
    if body.selective_user_ids is not None:
        await comments_repo.set_comment_grants(session, comment_id, body.selective_user_ids)
        selective_ids = list(set(body.selective_user_ids))
    if plan.audit_entry is not None:
        await rooms_repo.insert_audit_log(session, plan.audit_entry)

    images = await _comment_images(session, comment_id)
    characters = await _characters_for(session, [plan.comment], membership)
    return _to_response(
        plan.comment,
        selective_ids,
        images,
        await sign_images(images),
        membership,
        characters,
        parent_hidden=found.thread.parent_hidden(comment, membership),
    )


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """FR-T5: the author, or the Master moderating, deletes a Comment. It stays
    as an empty placeholder, and its images are removed with it so they don't
    linger in the Document gallery."""
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    comment = (
        await _get_visible_comment(session, document_id, comment_id, membership, locale)
    ).comment

    try:
        deleted = plan_comment_deletion(comment, requester_id, membership.role, datetime.now(UTC))
    except CannotDeleteCommentError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except CommentDeletedError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

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
    locale: str,
) -> CommentResponse:
    """Attaches one image (an uploaded file, or a URL to import) to a
    Comment. It becomes a Document image too, linked to the Comment."""
    found = await _get_visible_comment(session, document.id, comment_id, membership, locale)
    comment = found.comment
    # Locks the Document first, so the Comment's own count below can't race
    # a concurrent attachment either.
    document_images = await ensure_room_for_another_image(session, document, locale)
    images = await _comment_images(session, comment_id)
    try:
        ensure_can_attach_image(comment, membership.user_id, len(images))
    except (NotCommentAuthorError, CommentDeletedError, TooManyCommentImagesError) as exc:
        raise _author_error(exc, locale) from exc

    data = await fetch_url(source, locale) if isinstance(source, str) else await read_upload(source)
    image = await store_image(
        session, document, membership.user_id, data, document_images, locale, post_id=comment.id
    )
    all_images = [*images, image]
    characters = await _characters_for(session, [comment], membership)
    return _to_response(
        comment,
        found.selective_ids,
        all_images,
        await sign_images(all_images),
        membership,
        characters,
        parent_hidden=found.thread.parent_hidden(comment, membership),
    )


@router.post("/{comment_id}/images", status_code=status.HTTP_201_CREATED)
async def upload_comment_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """The author attaches an uploaded image, up to `MAX_IMAGES_PER_COMMENT`.
    It also counts toward the Document's limit."""
    requester_id = uuid.UUID(current_user.id)
    membership, document = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    return await _attach_image(session, membership, document, comment_id, file, locale)


@router.post("/{comment_id}/images/from-url", status_code=status.HTTP_201_CREATED)
async def import_comment_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: ImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """Like `upload_comment_image`, with the image fetched from a URL."""
    requester_id = uuid.UUID(current_user.id)
    membership, document = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    return await _attach_image(session, membership, document, comment_id, str(body.url), locale)


@router.delete("/{comment_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    image_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """The author removes one of their Comment's images."""
    requester_id = uuid.UUID(current_user.id)
    membership, _ = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    comment = (
        await _get_visible_comment(session, document_id, comment_id, membership, locale)
    ).comment
    try:
        ensure_can_detach_image(comment, requester_id)
    except (NotCommentAuthorError, CommentDeletedError) as exc:
        raise _author_error(exc, locale) from exc

    image = next((i for i in await _comment_images(session, comment_id) if i.id == image_id), None)
    if image is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.image.notFound", locale)
    await remove_images(session, [image])

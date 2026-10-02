"""Comments on a Document's main Thread (D-20, FR-T1, FR-T5, FR-T7). A Comment is
reachable only through a Document the requester can see, and is then filtered
by its effective visibility: its own (VR-03) and, for a reply, that of every
Comment above it (spec 19, D-17)."""

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    ensure_room_members,
    get_visible_document,
    require_membership,
    visible_documents,
)
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
from app.db import comments_repo, documents_repo, reactions_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.characters import CannotPostAsError, character_shown_to, ensure_can_post_as
from app.domain.comments import (
    CannotDeleteCommentError,
    CannotPinCommentError,
    CannotResolveCommentError,
    CommentBodyRequiredError,
    CommentDeletedError,
    CommentTooLongError,
    NotCommentAuthorError,
    NotTopLevelCommentError,
    ParentCommentDeletedError,
    ReplyWiderThanParentError,
    TooManyCommentImagesError,
    TooManyPinnedCommentsError,
    can_delete_comment,
    can_edit_comment,
    can_pin_comment,
    can_resolve_comment,
    ensure_can_attach_image,
    ensure_can_detach_image,
    ensure_not_wider,
    plan_comment_deletion,
    plan_comment_edit,
    plan_new_comment,
    plan_pin,
    plan_reopen,
    plan_resolve,
    plan_unpin,
)
from app.domain.documents import is_owner
from app.domain.errors import DomainError
from app.domain.mentions import unlink_non_members
from app.domain.models import (
    Comment,
    Document,
    DocumentImage,
    DocumentVisibility,
    Membership,
    PromotionTarget,
    Reaction,
)
from app.domain.promotion import (
    CannotPromoteCommentError,
    CannotPromoteIntoDocumentError,
    PromotionIntoSameDocumentError,
    PromotionWidensVisibilityError,
    can_promote_comment,
    newly_reached_members,
    plan_promotion,
)
from app.domain.reactions import (
    InvalidEmojiError,
    ReactionOnDeletedCommentError,
    TooManyReactionEmojiError,
    ensure_can_react,
    parse_emoji,
    summarize_reactions,
)
from app.domain.visibility import (
    is_comment_visible_in_thread,
    is_document_visible,
    is_parent_hidden,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/documents/{document_id}/comments", tags=["comments"])


class ReactionResponse(BaseModel):
    """One emoji on a Comment (spec 19c): how many members reacted with it,
    whether the requester is one of them, and who, in the order they
    reacted. The client names them through the members list."""

    emoji: str
    count: int
    reacted_by_me: bool
    user_ids: list[uuid.UUID]


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
    # Emoji reactions (spec 19c), in the order each emoji was first used.
    # Always empty on a deleted placeholder.
    reactions: list[ReactionResponse]
    # Set on a pinned top-level Comment (spec 19c Decision 3); the client
    # shows pinned Comments first, ordered by this.
    pinned_at: datetime | None
    # Set while a top-level Comment's branch is resolved (Decision 4), with
    # who resolved it; the client shows the branch collapsed.
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None
    # Whether the requester may pin or unpin it (an Owner or the Master, on a
    # top-level Comment that isn't deleted) and resolve or reopen its branch
    # (also its author).
    can_pin: bool
    can_resolve: bool
    # The latest promotion of the Comment's text (spec 19c Decision 5): when,
    # and into what. `promoted_document_id` names the new Document only for a
    # viewer who sees it (VR-07); `can_promote` says whether the requester may
    # promote it (an Owner or the Master, on a Comment that isn't deleted).
    promoted_at: datetime | None
    promoted_to: PromotionTarget | None
    promoted_document_id: uuid.UUID | None
    can_promote: bool


class PromoteCommentRequest(BaseModel):
    """Where the Comment's text went: the Document's own description, or
    the new Document `document_id`. `confirm_widening` is the promoter's
    answer to the warning that the text will reach members who can't read
    the Comment."""

    target: PromotionTarget
    document_id: uuid.UUID | None = None
    confirm_widening: bool = False


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
    manages_document: bool,
    parent_hidden: bool = False,
    reactions: Collection[Reaction] = (),
    visible_document_ids: Collection[uuid.UUID] = (),
) -> CommentResponse:
    """Serializes a Comment for `viewer`, with the permission flags the UI
    shows or hides its actions by; `manages_document` says whether the viewer
    is an Owner of the Document or the Master (D-12). `characters` holds only
    the Characters the viewer sees (`visible_characters`). With
    `parent_hidden`, `parent_id` is withheld (spec 19 Decision 6).
    `reactions` are the Comment's, oldest first. `visible_document_ids` holds
    the Documents the Comment was promoted into that the viewer sees."""
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
        reactions=[
            ReactionResponse(
                emoji=summary.emoji,
                count=summary.count,
                reacted_by_me=summary.reacted_by_me,
                user_ids=summary.user_ids,
            )
            for summary in summarize_reactions(reactions, viewer.user_id)
        ],
        pinned_at=comment.pinned_at,
        resolved_at=comment.resolved_at,
        resolved_by=comment.resolved_by,
        can_pin=can_pin_comment(comment, manages_document),
        can_resolve=can_resolve_comment(comment, viewer.user_id, manages_document),
        promoted_at=comment.promoted_at,
        promoted_to=comment.promoted_to,
        promoted_document_id=(
            comment.promoted_document_id
            if comment.promoted_document_id in visible_document_ids
            else None
        ),
        can_promote=can_promote_comment(comment, manages_document),
    )


async def _characters_for(
    session: AsyncSession, comments: Collection[Comment], viewer: Membership
) -> Mapping[uuid.UUID, CharacterResponse]:
    """The Characters these Comments were written as, those `viewer` may see
    (VR-13)."""
    ids = {c.as_document_id for c in comments if c.as_document_id is not None}
    return await visible_characters(session, ids, viewer)


async def _visible_promotion_targets(
    session: AsyncSession, comments: Collection[Comment], viewer: Membership
) -> set[uuid.UUID]:
    """The Documents these Comments were promoted into that `viewer` sees
    (VR-07): a hidden one isn't named."""
    ids = {c.promoted_document_id for c in comments if c.promoted_document_id is not None}
    if not ids:
        return set()
    documents = await documents_repo.get_documents_by_ids(session, list(ids))
    return {document.id for document in await visible_documents(session, documents, viewer)}


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


async def _clean_mentions(session: AsyncSession, room_id: uuid.UUID, body: str) -> str:
    """The body with `@` mentions of anyone outside the Room turned back into
    plain text (spec 19c Decision 2), so only members are ever linked."""
    members = await rooms_repo.list_memberships(session, room_id)
    return unlink_non_members(body, {member.user_id for member in members})


async def _validate_grantees(
    session: AsyncSession, room_id: uuid.UUID, user_ids: Collection[uuid.UUID], locale: str
) -> None:
    """422 unless every Selective grantee is a member of the Room."""
    await ensure_room_members(
        session, room_id, user_ids, "errors.comment.invalidSelectiveUsers", locale
    )


@dataclass(frozen=True)
class _Viewer:
    """The requester's Membership, and whether they manage the Document: one
    of its Owners or the Master (D-12), who may pin its Comments (spec 19c)."""

    membership: Membership
    manages_document: bool


@dataclass(frozen=True)
class _VisibleComment:
    """A Comment the viewer is known to see, with what its routes need."""

    comment: Comment
    selective_ids: list[uuid.UUID]
    thread: _Thread


async def _single_response(
    session: AsyncSession,
    found: _VisibleComment,
    viewer: _Viewer,
    comment: Comment | None = None,
    selective_ids: Collection[uuid.UUID] | None = None,
    images: list[DocumentImage] | None = None,
) -> CommentResponse:
    """The response for one Comment the viewer sees, read fresh: its images,
    Character and reactions. `comment`, `selective_ids` and `images` override
    what `found` holds, for a route that has just changed them."""
    comment = found.comment if comment is None else comment
    images = await _comment_images(session, comment.id) if images is None else images
    characters = await _characters_for(session, [comment], viewer.membership)
    reactions = await reactions_repo.list_reactions_for_comments(session, [comment.id])
    targets = await _visible_promotion_targets(session, [comment], viewer.membership)
    return _to_response(
        comment,
        found.selective_ids if selective_ids is None else selective_ids,
        images,
        await sign_images(images),
        viewer.membership,
        characters,
        manages_document=viewer.manages_document,
        parent_hidden=found.thread.parent_hidden(comment, viewer.membership),
        reactions=reactions[comment.id],
        visible_document_ids=targets,
    )


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
) -> tuple[_Viewer, Document]:
    """The requester and the Document, once they are known to be a member who
    can see it."""
    membership = await require_membership(session, room_id, requester_id, locale)
    document, owner_ids, _ = await get_visible_document(
        session, room_id, document_id, requester_id, membership.role, locale
    )
    viewer = _Viewer(
        membership=membership,
        manages_document=is_owner(membership.role, requester_id, owner_ids),
    )
    return viewer, document


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
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership

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
    reactions = await reactions_repo.list_reactions_for_comments(session, [c.id for c in visible])
    targets = await _visible_promotion_targets(session, visible, membership)
    return [
        _to_response(
            comment,
            grants[comment.id],
            images[comment.id],
            image_urls,
            membership,
            characters,
            manages_document=viewer.manages_document,
            parent_hidden=thread.parent_hidden(comment, membership),
            reactions=reactions[comment.id],
            visible_document_ids=targets,
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
    the reply would reach someone who can't read it (VR-04). `@[Name](user:id)`
    mentions a member (spec 19c); one naming anyone else is saved as plain
    `@Name`. A mention never widens who sees the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership

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
            await _clean_mentions(session, room_id, body.body),
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
    return _to_response(
        comment,
        set(body.selective_user_ids),
        [],
        {},
        membership,
        characters,
        manages_document=viewer.manages_document,
    )


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
    (VR-04, spec 19); editing only the body never re-checks it. A new body's
    `@` mentions are cleaned as on creation (spec 19c)."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership
    found = await _get_visible_comment(session, document_id, comment_id, membership, locale)
    comment, selective_ids = found.comment, found.selective_ids

    change_character = "as_document_id" in body.model_fields_set
    try:
        plan = plan_comment_edit(
            comment,
            room_id,
            requester_id,
            datetime.now(UTC),
            body=None if body.body is None else await _clean_mentions(session, room_id, body.body),
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

    return await _single_response(
        session, found, viewer, comment=plan.comment, selective_ids=selective_ids
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
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership
    await _get_visible_comment(session, document_id, comment_id, membership, locale)
    # Under the Comment's lock, like reacting and pinning, so no reaction
    # lands on the placeholder after its reactions are cleared below, and no
    # pin after it is unpinned. Read as of the lock, so the pin and
    # resolution written back are current.
    comment = await comments_repo.get_locked_comment(session, comment_id)

    try:
        deleted = plan_comment_deletion(comment, requester_id, membership.role, datetime.now(UTC))
    except CannotDeleteCommentError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except CommentDeletedError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    # A deleted Comment's images go too - they'd otherwise outlive the
    # Comment in the Document gallery (moderation must actually remove them).
    await remove_images(session, await _comment_images(session, comment_id))
    await reactions_repo.delete_reactions_for_comment(session, comment_id)
    await comments_repo.update_comment(session, deleted)
    await comments_repo.set_pin_and_resolution(session, deleted)


async def _attach_image(
    session: AsyncSession,
    viewer: _Viewer,
    document: Document,
    comment_id: uuid.UUID,
    source: UploadFile | str,
    locale: str,
) -> CommentResponse:
    """Attaches one image (an uploaded file, or a URL to import) to a
    Comment. It becomes a Document image too, linked to the Comment."""
    membership = viewer.membership
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
    return await _single_response(session, found, viewer, images=[*images, image])


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
    viewer, document = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    return await _attach_image(session, viewer, document, comment_id, file, locale)


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
    viewer, document = await _require_visible_document(
        session, room_id, document_id, requester_id, locale
    )
    return await _attach_image(session, viewer, document, comment_id, str(body.url), locale)


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
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership
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


def _parse_emoji(emoji: str, locale: str) -> str:
    """The path's emoji once it is one emoji grapheme; 422 otherwise."""
    try:
        return parse_emoji(emoji)
    except InvalidEmojiError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc


@router.put("/{comment_id}/reactions/{emoji}")
async def add_reaction(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    emoji: str,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T6 (spec 19c Decision 1): any member who sees the Comment reacts
    with one emoji (URL-encoded in the path; 422 for anything else, text
    included). Idempotent: reacting again with the same emoji changes
    nothing. 409 on a deleted Comment, or for a new emoji once the Comment
    has `MAX_EMOJI_PER_COMMENT` different ones. Returns the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership
    found = await _get_visible_comment(session, document_id, comment_id, membership, locale)
    clean = _parse_emoji(emoji, locale)

    # Checked under the Comment's lock, so two new emoji can't both take the
    # last free slot, and a concurrent deletion (which takes the same lock)
    # can't leave a reaction on its placeholder.
    deleted_at = await comments_repo.lock_comment(session, comment_id)
    existing = (await reactions_repo.list_reactions_for_comments(session, [comment_id]))[comment_id]
    try:
        ensure_can_react(
            replace(found.comment, deleted_at=deleted_at),
            clean,
            {reaction.emoji for reaction in existing},
        )
    except (ReactionOnDeletedCommentError, TooManyReactionEmojiError) as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
    await reactions_repo.add_reaction(session, comment_id, requester_id, clean, datetime.now(UTC))
    return await _single_response(session, found, viewer)


@router.delete("/{comment_id}/reactions/{emoji}")
async def remove_reaction(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    emoji: str,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T6: the requester takes back their own reaction with this emoji;
    nobody removes someone else's. Idempotent: an emoji they hadn't used
    changes nothing. 404 for a Comment they can't see (VR-07). Returns the
    Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership
    found = await _get_visible_comment(session, document_id, comment_id, membership, locale)
    clean = _parse_emoji(emoji, locale)
    await reactions_repo.remove_reaction(session, comment_id, requester_id, clean)
    return await _single_response(session, found, viewer)


async def _locked_visible(
    session: AsyncSession,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    viewer: _Viewer,
    locale: str,
) -> tuple[_VisibleComment, Comment]:
    """The Comment once the viewer is known to see it (404 otherwise, VR-07),
    and as read again under its lock: pinning, resolving, promoting and
    deleting serialize on it, so each decides on the current pin, resolution
    and deletion (spec 19c)."""
    found = await _get_visible_comment(session, document_id, comment_id, viewer.membership, locale)
    return found, await comments_repo.get_locked_comment(session, comment_id)


def _pin_or_resolve_error(exc: DomainError, locale: str) -> HTTPException:
    """403 for someone who may not do it, 422 for a reply, 409 for a deleted
    Comment or a Document already at its pinned limit."""
    if isinstance(exc, (CannotPinCommentError, CannotResolveCommentError)):
        return translated_error(status.HTTP_403_FORBIDDEN, exc, locale)
    if isinstance(exc, NotTopLevelCommentError):
        return translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale)
    return translated_error(status.HTTP_409_CONFLICT, exc, locale)


@router.post("/{comment_id}/pin")
async def pin_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T7 (spec 19c Decision 3): an Owner of the Document or the Master pins
    a top-level Comment, shown first to everyone who sees it. 403 for anyone
    else, 422 for a reply, 409 for a deleted Comment or once the Document has
    `MAX_PINNED_PER_DOCUMENT` pinned Comments. Idempotent: pinning a pinned
    Comment keeps its place. Returns the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    found, comment = await _locked_visible(session, document_id, comment_id, viewer, locale)
    # The count is read under the Document's lock, taken after the Comment's
    # (the order deleting a Comment with images takes them in), so two pins
    # can't both take the last slot.
    await documents_repo.lock_document(session, document_id)
    pinned_count = await comments_repo.count_pinned_comments(session, document_id)
    try:
        pinned = plan_pin(comment, viewer.manages_document, pinned_count, datetime.now(UTC))
    except (
        CannotPinCommentError,
        NotTopLevelCommentError,
        CommentDeletedError,
        TooManyPinnedCommentsError,
    ) as exc:
        raise _pin_or_resolve_error(exc, locale) from exc
    await comments_repo.set_pin_and_resolution(session, pinned)
    return await _single_response(session, found, viewer, comment=pinned)


@router.delete("/{comment_id}/pin")
async def unpin_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T7: an Owner or the Master unpins a Comment (403 for anyone else).
    Idempotent on a Comment that isn't pinned. Returns the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    found, comment = await _locked_visible(session, document_id, comment_id, viewer, locale)
    try:
        unpinned = plan_unpin(comment, viewer.manages_document)
    except CannotPinCommentError as exc:
        raise _pin_or_resolve_error(exc, locale) from exc
    await comments_repo.set_pin_and_resolution(session, unpinned)
    return await _single_response(session, found, viewer, comment=unpinned)


@router.post("/{comment_id}/resolve")
async def resolve_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T7 (spec 19c Decision 4): the author of a top-level Comment, an Owner
    of the Document or the Master marks its branch resolved, which the client
    shows collapsed. 403 for anyone else, 422 for a reply. Also allowed on a
    deleted top-level Comment, whose replies still form a branch. Idempotent:
    resolving again keeps who resolved it first. A new reply doesn't reopen
    it. Returns the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    found, comment = await _locked_visible(session, document_id, comment_id, viewer, locale)
    try:
        resolved = plan_resolve(comment, requester_id, viewer.manages_document, datetime.now(UTC))
    except (CannotResolveCommentError, NotTopLevelCommentError) as exc:
        raise _pin_or_resolve_error(exc, locale) from exc
    await comments_repo.set_pin_and_resolution(session, resolved)
    return await _single_response(session, found, viewer, comment=resolved)


@router.delete("/{comment_id}/resolve")
async def reopen_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T7: reopens a resolved branch, by the same people who may resolve it
    (403 otherwise, 422 for a reply). Idempotent on an open branch. Returns
    the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    found, comment = await _locked_visible(session, document_id, comment_id, viewer, locale)
    try:
        reopened = plan_reopen(comment, requester_id, viewer.manages_document)
    except (CannotResolveCommentError, NotTopLevelCommentError) as exc:
        raise _pin_or_resolve_error(exc, locale) from exc
    await comments_repo.set_pin_and_resolution(session, reopened)
    return await _single_response(session, found, viewer, comment=reopened)


def _promotion_error(exc: DomainError, locale: str) -> HTTPException:
    """403 for someone who may not promote it or into that Document, 422 for
    the Comment's own Document named as a new one, 409 for a deleted Comment
    or an unconfirmed widening."""
    if isinstance(exc, (CannotPromoteCommentError, CannotPromoteIntoDocumentError)):
        return translated_error(status.HTTP_403_FORBIDDEN, exc, locale)
    if isinstance(exc, PromotionIntoSameDocumentError):
        return translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale)
    return translated_error(status.HTTP_409_CONFLICT, exc, locale)


@router.post("/{comment_id}/promote")
async def promote_comment(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: PromoteCommentRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> CommentResponse:
    """FR-T8 (spec 19c Decision 5): an Owner of the Document or the Master
    records that a Comment's text was promoted into the Document's
    description or into a new Document (`document_id`, which they must
    manage too); the text itself is saved through the description and
    Document routes. When the target reaches members who can't read the
    Comment, `confirm_widening` must be true (409 otherwise). Audited in the
    same transaction (VR-08, Invariant 7). 404 for a Comment, or a new
    Document, the caller can't see (VR-07); 403 for anyone else; 422 for no
    `document_id` with `document`, or the Comment's own Document; 409 for a
    deleted Comment. Returns the Comment."""
    requester_id = uuid.UUID(current_user.id)
    viewer, _ = await _require_visible_document(session, room_id, document_id, requester_id, locale)
    membership = viewer.membership
    if body.target is PromotionTarget.DESCRIPTION:
        target_id = document_id
    elif body.document_id is None:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.comment.promoteDocumentRequired", locale
        )
    else:
        target_id = body.document_id
    target, target_owner_ids, target_selective_ids = await get_visible_document(
        session, room_id, target_id, requester_id, membership.role, locale
    )
    found, comment = await _locked_visible(session, document_id, comment_id, viewer, locale)
    members = await rooms_repo.list_memberships(session, room_id)
    newly_reached = newly_reached_members(
        members,
        lambda member: found.thread.is_visible(comment, member),
        lambda member: is_document_visible(
            target, member.user_id, member.role, target_owner_ids, target_selective_ids
        ),
    )
    try:
        plan = plan_promotion(
            comment,
            room_id,
            requester_id,
            viewer.manages_document,
            body.target,
            target.id,
            target.visibility,
            is_owner(membership.role, requester_id, target_owner_ids),
            newly_reached,
            body.confirm_widening,
            datetime.now(UTC),
        )
    except (
        CannotPromoteCommentError,
        CannotPromoteIntoDocumentError,
        CommentDeletedError,
        PromotionIntoSameDocumentError,
        PromotionWidensVisibilityError,
    ) as exc:
        raise _promotion_error(exc, locale) from exc
    await comments_repo.set_promotion(session, plan.comment)
    await rooms_repo.insert_audit_log(session, plan.audit_entry)
    return await _single_response(session, found, viewer, comment=plan.comment)

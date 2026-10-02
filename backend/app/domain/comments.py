"""Rules for Comments (FR-T1, FR-T5, FR-T7): who may write, edit and delete
them, what they may answer and how wide a reply may be (spec 19), who may pin
them or resolve their branch (spec 19c), their length and image limits, and
when an edit must be audited."""

import uuid
from collections.abc import Collection
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, Comment, DocumentVisibility, Membership, RoomRole
from app.domain.visibility import is_comment_visible, is_content_visible

MAX_COMMENT_LENGTH = 10_000

# Images attached to one Comment. They also count toward the Document's
# own limit (MAX_IMAGES_PER_DOCUMENT), since they're Document images too.
MAX_IMAGES_PER_COMMENT = 4

# Pinned Comments on one Document (spec 19c Decision 3).
MAX_PINNED_PER_DOCUMENT = 3

COMMENT_VISIBILITY_CHANGED = "comment_visibility_changed"


class CommentBodyRequiredError(DomainError):
    """The Comment body is empty once trimmed."""


class CommentTooLongError(DomainError):
    """The Comment body is over `MAX_COMMENT_LENGTH`."""


class NotCommentAuthorError(DomainError):
    """Only a Comment's author may do this."""


class CannotDeleteCommentError(DomainError):
    """Neither the author nor the Master: can't delete the Comment."""


class CommentDeletedError(DomainError):
    """The Comment was already deleted; it can't be changed any more."""


class TooManyCommentImagesError(DomainError):
    """The Comment already has `MAX_IMAGES_PER_COMMENT` images."""


class ParentCommentNotFoundError(DomainError):
    """The Comment being answered isn't on this Document (or can't be seen,
    which answers the same, VR-07)."""


class ParentCommentDeletedError(DomainError):
    """The Comment being answered was deleted: a placeholder can't be
    answered (spec 19)."""


class ReplyWiderThanParentError(DomainError):
    """A reply would reach someone who can't read the Comment it answers
    (VR-04, I-09)."""


class CannotPinCommentError(DomainError):
    """Neither an Owner of the Document nor the Master: can't pin or unpin
    its Comments (spec 19c Decision 3)."""


class CannotResolveCommentError(DomainError):
    """Neither the Comment's author, an Owner of the Document nor the Master:
    can't resolve or reopen its branch (spec 19c Decision 4)."""


class NotTopLevelCommentError(DomainError):
    """Only a top-level Comment is pinned or resolved; a reply goes with its
    branch (spec 19c)."""


class TooManyPinnedCommentsError(DomainError):
    """The Document already has `MAX_PINNED_PER_DOCUMENT` pinned Comments."""


@dataclass(frozen=True)
class CommentEditPlan:
    """The edited Comment, and the audit entry to write with it when the edit
    changes who can see it."""

    comment: Comment
    # Invariant 7 / VR-08: set only when the edit changes who can see the
    # Comment, and written in the same transaction as the edit itself.
    audit_entry: AuditLogEntry | None


def _clean_body(body: str) -> str:
    """Trims the body and enforces that it's non-empty and within
    `MAX_COMMENT_LENGTH`."""
    clean = body.strip()
    if not clean:
        raise CommentBodyRequiredError("errors.comment.bodyRequired")
    if len(clean) > MAX_COMMENT_LENGTH:
        raise CommentTooLongError("errors.comment.tooLong", max=MAX_COMMENT_LENGTH)
    return clean


def plan_new_comment(
    document_id: uuid.UUID,
    author_id: uuid.UUID,
    body: str,
    visibility: DocumentVisibility,
    now: datetime,
    as_document_id: uuid.UUID | None = None,
    parent: Comment | None = None,
) -> Comment:
    """UC-11/FR-T1: any member who sees the Document can comment on it -
    the caller has already checked the Document is visible to the author, and,
    with `as_document_id`, that they may write as that Character (D-24,
    `characters.ensure_can_post_as`). With `parent` the Comment is a reply
    (spec 19): the parent must be on the same Document and not deleted. The
    caller has already checked the author sees the parent, and checks the
    reply isn't wider than it (`ensure_not_wider`)."""
    if parent is not None:
        if parent.document_id != document_id:
            raise ParentCommentNotFoundError("errors.comment.parentNotFound")
        if parent.deleted_at is not None:
            raise ParentCommentDeletedError("errors.comment.parentDeleted")
    return Comment(
        id=uuid.uuid4(),
        document_id=document_id,
        author_id=author_id,
        body=_clean_body(body),
        visibility=visibility,
        created_at=now,
        updated_at=now,
        as_document_id=as_document_id,
        parent_id=None if parent is None else parent.id,
    )


def ensure_not_wider(
    author_id: uuid.UUID,
    visibility: DocumentVisibility,
    selective_user_ids: Collection[uuid.UUID],
    parent: Comment,
    parent_selective_ids: Collection[uuid.UUID],
    members: Collection[Membership],
) -> None:
    """VR-04/I-09 (spec 19 Decision 2): a reply is never more visible than the
    Comment it answers. Compares audiences, the Room's members who would see
    each on its own, rather than level names, since Selective and Private
    aren't ordered. The reply's author is left out: they always see their own
    reply (VR-02), even once the parent is narrowed past them. Checked on
    create and on every visibility or grant edit of a reply; narrowing the
    parent later is allowed and hides the branch instead
    (`is_comment_visible_in_thread`)."""
    for member in members:
        if member.user_id == author_id:
            continue
        sees_reply = is_content_visible(
            visibility, member.user_id, member.role, {author_id}, selective_user_ids
        )
        if sees_reply and not is_comment_visible(
            parent, member.user_id, member.role, parent_selective_ids
        ):
            raise ReplyWiderThanParentError("errors.comment.replyWiderThanParent")


def can_edit_comment(comment: Comment, user_id: uuid.UUID) -> bool:
    """FR-T5: a Comment is edited only by its author (its Owner). Unlike a
    Document (D-12), the Master has no implicit edit right - they moderate
    by deleting instead (section 9's permission matrix)."""
    return comment.deleted_at is None and comment.author_id == user_id


def can_delete_comment(comment: Comment, user_id: uuid.UUID, role: RoomRole) -> bool:
    """FR-T5: the author deletes their own Comment; the Master can moderate
    (delete) anyone's."""
    return comment.deleted_at is None and (comment.author_id == user_id or role == RoomRole.MASTER)


def plan_comment_edit(
    comment: Comment,
    room_id: uuid.UUID,
    editor_id: uuid.UUID,
    now: datetime,
    body: str | None = None,
    visibility: DocumentVisibility | None = None,
    current_selective_ids: Collection[uuid.UUID] = (),
    new_selective_ids: Collection[uuid.UUID] | None = None,
    change_character: bool = False,
    as_document_id: uuid.UUID | None = None,
) -> CommentEditPlan:
    """FR-T5: the author edits their own Comment. Changing its visibility level
    or its Selective grants produces an audit entry (VR-08, Invariant 7);
    editing only the body does not. With `change_character`, the Comment is
    rewritten as `as_document_id` (None = as the author themselves); the
    caller has already checked they may write as it (D-24). The Post still
    belongs to its author, so that isn't audited."""
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.deleted")
    if comment.author_id != editor_id:
        raise NotCommentAuthorError("errors.comment.notAuthor")

    updated = replace(
        comment,
        body=comment.body if body is None else _clean_body(body),
        visibility=comment.visibility if visibility is None else visibility,
        as_document_id=as_document_id if change_character else comment.as_document_id,
        updated_at=now,
    )

    grants_changed = new_selective_ids is not None and set(new_selective_ids) != set(
        current_selective_ids
    )
    audit_entry = None
    if updated.visibility != comment.visibility or grants_changed:
        audit_entry = AuditLogEntry(
            id=uuid.uuid4(),
            room_id=room_id,
            actor_user_id=editor_id,
            target_user_id=comment.author_id,
            action=COMMENT_VISIBILITY_CHANGED,
            details={
                "comment_id": str(comment.id),
                "document_id": str(comment.document_id),
                "from": comment.visibility.value,
                "to": updated.visibility.value,
                "selective_user_ids": sorted(
                    str(user_id)
                    for user_id in (
                        current_selective_ids if new_selective_ids is None else new_selective_ids
                    )
                ),
            },
        )
    return CommentEditPlan(comment=updated, audit_entry=audit_entry)


def plan_comment_deletion(
    comment: Comment, requester_id: uuid.UUID, role: RoomRole, now: datetime
) -> Comment:
    """FR-T5: deletion leaves a placeholder (the row, emptied) so the
    conversation isn't broken. The placeholder is unpinned, freeing its slot
    (spec 19c); a resolved branch stays resolved."""
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.alreadyDeleted")
    if not can_delete_comment(comment, requester_id, role):
        raise CannotDeleteCommentError("errors.comment.cannotDelete")
    return replace(comment, body="", deleted_at=now, updated_at=now, pinned_at=None)


def ensure_can_attach_image(
    comment: Comment, editor_id: uuid.UUID, current_comment_image_count: int
) -> None:
    """Attaching or removing a Comment's images is part of editing the
    Comment, so it follows the same rule: its author only (FR-T5)."""
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.deleted")
    if comment.author_id != editor_id:
        raise NotCommentAuthorError("errors.comment.notAuthorImages")
    if current_comment_image_count >= MAX_IMAGES_PER_COMMENT:
        raise TooManyCommentImagesError("errors.comment.tooManyImages", max=MAX_IMAGES_PER_COMMENT)


def ensure_can_detach_image(comment: Comment, editor_id: uuid.UUID) -> None:
    """Removing an image follows the same rule as attaching one: the author
    only, and never on a deleted Comment (FR-T5)."""
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.deleted")
    if comment.author_id != editor_id:
        raise NotCommentAuthorError("errors.comment.notAuthorImages")


def can_pin_comment(comment: Comment, manages_document: bool) -> bool:
    """Spec 19c Decision 3: an Owner of the Document or the Master
    (`manages_document`, D-12) pins a top-level Comment, never a reply or a
    deleted placeholder. Says nothing about the per-Document limit, which
    only the pin itself checks."""
    return manages_document and comment.parent_id is None and comment.deleted_at is None


def can_resolve_comment(comment: Comment, user_id: uuid.UUID, manages_document: bool) -> bool:
    """Spec 19c Decision 4: the author of a top-level Comment, an Owner of
    the Document or the Master resolves or reopens its branch. A deleted
    top-level Comment still heads its branch, so it may still be resolved."""
    return comment.parent_id is None and (manages_document or comment.author_id == user_id)


def plan_pin(comment: Comment, manages_document: bool, pinned_count: int, now: datetime) -> Comment:
    """Pins a top-level Comment (spec 19c Decision 3): 403 unless an Owner or
    the Master, then a reply or a deleted placeholder is refused. Pinning a
    Comment that is already pinned changes nothing, so its place among the
    pinned ones is kept. `pinned_count` is the Document's pinned Comments,
    read under the Document's lock so two pins can't both take the last
    slot."""
    if not manages_document:
        raise CannotPinCommentError("errors.comment.cannotPin")
    if comment.parent_id is not None:
        raise NotTopLevelCommentError("errors.comment.pinReply")
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.deleted")
    if comment.pinned_at is not None:
        return comment
    if pinned_count >= MAX_PINNED_PER_DOCUMENT:
        raise TooManyPinnedCommentsError(
            "errors.comment.tooManyPinned", max=MAX_PINNED_PER_DOCUMENT
        )
    return replace(comment, pinned_at=now)


def plan_unpin(comment: Comment, manages_document: bool) -> Comment:
    """Unpins a Comment: the same people who may pin it. Idempotent, so a
    Comment that isn't pinned (a reply, a deleted placeholder) is simply
    returned unpinned."""
    if not manages_document:
        raise CannotPinCommentError("errors.comment.cannotPin")
    return replace(comment, pinned_at=None)


def _ensure_can_resolve(comment: Comment, user_id: uuid.UUID, manages_document: bool) -> None:
    """403 unless `can_resolve_comment` would allow it for a top-level
    Comment, then refuses a reply."""
    if not (manages_document or comment.author_id == user_id):
        raise CannotResolveCommentError("errors.comment.cannotResolve")
    if comment.parent_id is not None:
        raise NotTopLevelCommentError("errors.comment.resolveReply")


def plan_resolve(
    comment: Comment, user_id: uuid.UUID, manages_document: bool, now: datetime
) -> Comment:
    """Marks a top-level Comment's branch resolved (spec 19c Decision 4).
    Resolving one that is already resolved keeps who resolved it and when.
    New replies don't reopen it: only `plan_reopen` does."""
    _ensure_can_resolve(comment, user_id, manages_document)
    if comment.resolved_at is not None:
        return comment
    return replace(comment, resolved_at=now, resolved_by=user_id)


def plan_reopen(comment: Comment, user_id: uuid.UUID, manages_document: bool) -> Comment:
    """Reopens a resolved branch: the same people who may resolve it.
    Idempotent on an open one."""
    _ensure_can_resolve(comment, user_id, manages_document)
    return replace(comment, resolved_at=None, resolved_by=None)

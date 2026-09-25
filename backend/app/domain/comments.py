"""Rules for Comments (FR-T1, FR-T5): who may write, edit and delete them,
their length and image limits, and when an edit must be audited."""

import uuid
from collections.abc import Collection
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, Comment, DocumentVisibility, RoomRole

MAX_COMMENT_LENGTH = 10_000

# Images attached to one Comment. They also count toward the Document's
# own limit (MAX_IMAGES_PER_DOCUMENT), since they're Document images too.
MAX_IMAGES_PER_COMMENT = 4

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
) -> Comment:
    """UC-11/FR-T1: any member who sees the Document can comment on it -
    the caller has already checked the Document is visible to the author."""
    return Comment(
        id=uuid.uuid4(),
        document_id=document_id,
        author_id=author_id,
        body=_clean_body(body),
        visibility=visibility,
        created_at=now,
        updated_at=now,
    )


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
) -> CommentEditPlan:
    """FR-T5: the author edits their own Comment. Changing its visibility level
    or its Selective grants produces an audit entry (VR-08, Invariant 7);
    editing only the body does not."""
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.deleted")
    if comment.author_id != editor_id:
        raise NotCommentAuthorError("errors.comment.notAuthor")

    updated = replace(
        comment,
        body=comment.body if body is None else _clean_body(body),
        visibility=comment.visibility if visibility is None else visibility,
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
    conversation isn't broken."""
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.alreadyDeleted")
    if not can_delete_comment(comment, requester_id, role):
        raise CannotDeleteCommentError("errors.comment.cannotDelete")
    return replace(comment, body="", deleted_at=now, updated_at=now)


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

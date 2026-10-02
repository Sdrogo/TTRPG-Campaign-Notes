"""Promoting a Comment (FR-T8, spec 19c Decision 5): an Owner of the
Document or the Master takes a Comment's text into the Document's
description, or into a new Document. The text itself moves through the
existing description and Document routes; promotion records the "Promoted"
mark on the Comment and, since it can show the text to members who couldn't
read the Comment, an AuditLog row like a visibility change (VR-08)."""

import uuid
from collections.abc import Callable, Collection
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.comments import CommentDeletedError
from app.domain.errors import DomainError
from app.domain.models import (
    AuditLogEntry,
    Comment,
    DocumentVisibility,
    Membership,
    PromotionTarget,
)

COMMENT_PROMOTED = "comment_promoted"


class CannotPromoteCommentError(DomainError):
    """Only an Owner of the Comment's Document or the Master promotes it."""


class CannotPromoteIntoDocumentError(DomainError):
    """The new Document must be one the promoter manages (an Owner of it, or
    the Master)."""


class PromotionIntoSameDocumentError(DomainError):
    """Promoting into a new Document named the Comment's own Document."""


class PromotionWidensVisibilityError(DomainError):
    """The promotion would show the text to members who can't read the
    Comment, and that wasn't confirmed."""


@dataclass(frozen=True)
class PromotionPlan:
    """The Comment with its "Promoted" mark, and the audit entry written in
    the same transaction (Invariant 7)."""

    comment: Comment
    audit_entry: AuditLogEntry


def can_promote_comment(comment: Comment, manages_document: bool) -> bool:
    """FR-T8: an Owner of the Document or the Master (D-12) promotes a
    Comment that isn't a deleted placeholder (there is no text left to
    promote). A reply can be promoted like a top-level Comment."""
    return manages_document and comment.deleted_at is None


def newly_reached_members(
    members: Collection[Membership],
    sees_comment: Callable[[Membership], bool],
    sees_target: Callable[[Membership], bool],
) -> list[uuid.UUID]:
    """The members who would read the promoted text without reading the
    Comment now (spec 19c: promotion can widen who sees it), by user id.
    `sees_comment` is the Comment's effective visibility, its parents
    included; `sees_target` the target Document's."""
    return sorted(
        member.user_id for member in members if sees_target(member) and not sees_comment(member)
    )


def plan_promotion(
    comment: Comment,
    room_id: uuid.UUID,
    actor_id: uuid.UUID,
    manages_document: bool,
    target: PromotionTarget,
    target_document_id: uuid.UUID,
    target_visibility: DocumentVisibility,
    manages_target: bool,
    newly_reached: Collection[uuid.UUID],
    confirm_widening: bool,
    now: datetime,
) -> PromotionPlan:
    """FR-T8 (spec 19c Decision 5). Marks `comment` promoted into its own
    Document's description, or into the new Document `target_document_id`,
    which the promoter must manage too. When `newly_reached` isn't empty the
    promoter must have confirmed it (`confirm_widening`), after the warning
    the client shows. Promoting again records the latest promotion. Every
    promotion is audited, with who it newly reaches."""
    if not manages_document:
        raise CannotPromoteCommentError("errors.comment.cannotPromote")
    if comment.deleted_at is not None:
        raise CommentDeletedError("errors.comment.deleted")
    if target is PromotionTarget.DOCUMENT:
        if target_document_id == comment.document_id:
            raise PromotionIntoSameDocumentError("errors.comment.promoteIntoSameDocument")
        if not manages_target:
            raise CannotPromoteIntoDocumentError("errors.comment.cannotPromoteIntoDocument")
    if newly_reached and not confirm_widening:
        raise PromotionWidensVisibilityError("errors.comment.promotionWidens")

    promoted = replace(
        comment,
        promoted_at=now,
        promoted_by=actor_id,
        promoted_to=target,
        promoted_document_id=target_document_id if target is PromotionTarget.DOCUMENT else None,
    )
    audit_entry = AuditLogEntry(
        id=uuid.uuid4(),
        room_id=room_id,
        actor_user_id=actor_id,
        target_user_id=comment.author_id,
        action=COMMENT_PROMOTED,
        details={
            "comment_id": str(comment.id),
            "document_id": str(comment.document_id),
            "target": target.value,
            "target_document_id": str(target_document_id),
            "from": comment.visibility.value,
            "to": target_visibility.value,
            "newly_reached_user_ids": [str(user_id) for user_id in newly_reached],
        },
    )
    return PromotionPlan(comment=promoted, audit_entry=audit_entry)

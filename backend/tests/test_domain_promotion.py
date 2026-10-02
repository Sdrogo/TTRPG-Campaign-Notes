"""Promoting a Comment (spec 19c Decision 5, FR-T8): who may do it, into
what, the widening confirmation and the audit entry."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.comments import CommentDeletedError, plan_new_comment
from app.domain.models import Comment, DocumentVisibility, Membership, PromotionTarget, RoomRole
from app.domain.promotion import (
    COMMENT_PROMOTED,
    CannotPromoteCommentError,
    CannotPromoteIntoDocumentError,
    PromotionIntoSameDocumentError,
    PromotionPlan,
    PromotionWidensVisibilityError,
    can_promote_comment,
    newly_reached_members,
    plan_promotion,
)

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=5)
ROOM_ID = uuid.uuid4()
DOCUMENT_ID = uuid.uuid4()
NEW_DOCUMENT_ID = uuid.uuid4()
AUTHOR = uuid.uuid4()
OWNER = uuid.uuid4()


def _comment(visibility: DocumentVisibility = DocumentVisibility.ROOM) -> Comment:
    return plan_new_comment(DOCUMENT_ID, AUTHOR, "The key is under the mat.", visibility, NOW)


def _plan(
    comment: Comment | None = None,
    *,
    manages_document: bool = True,
    target: PromotionTarget = PromotionTarget.DESCRIPTION,
    target_document_id: uuid.UUID = DOCUMENT_ID,
    manages_target: bool = True,
    newly_reached: tuple[uuid.UUID, ...] = (),
    confirm_widening: bool = False,
    now: datetime = LATER,
) -> PromotionPlan:
    return plan_promotion(
        _comment() if comment is None else comment,
        ROOM_ID,
        OWNER,
        manages_document,
        target,
        target_document_id,
        DocumentVisibility.ROOM,
        manages_target,
        newly_reached,
        confirm_widening,
        now,
    )


def test_an_owner_or_the_master_may_promote_a_comment_that_is_not_deleted() -> None:
    assert can_promote_comment(_comment(), manages_document=True)
    assert not can_promote_comment(_comment(), manages_document=False)
    assert not can_promote_comment(replace(_comment(), deleted_at=NOW), manages_document=True)


def test_promoting_into_the_description_marks_the_comment() -> None:
    plan = _plan()

    promoted = plan.comment
    assert (promoted.promoted_at, promoted.promoted_by) == (LATER, OWNER)
    assert promoted.promoted_to is PromotionTarget.DESCRIPTION
    assert promoted.promoted_document_id is None


def test_promoting_into_a_new_document_links_it() -> None:
    plan = _plan(target=PromotionTarget.DOCUMENT, target_document_id=NEW_DOCUMENT_ID)

    assert plan.comment.promoted_to is PromotionTarget.DOCUMENT
    assert plan.comment.promoted_document_id == NEW_DOCUMENT_ID


def test_promoting_again_records_the_latest_promotion() -> None:
    first = _plan(target=PromotionTarget.DOCUMENT, target_document_id=NEW_DOCUMENT_ID).comment

    again = _plan(first, now=LATER + timedelta(minutes=1)).comment

    assert again.promoted_to is PromotionTarget.DESCRIPTION
    assert again.promoted_document_id is None
    assert again.promoted_at == LATER + timedelta(minutes=1)


def test_every_promotion_is_audited_with_who_it_newly_reaches() -> None:
    reached = (uuid.uuid4(),)
    comment = _comment(DocumentVisibility.PRIVATE)

    entry = _plan(comment, newly_reached=reached, confirm_widening=True).audit_entry

    assert entry.action == COMMENT_PROMOTED
    assert (entry.room_id, entry.actor_user_id, entry.target_user_id) == (ROOM_ID, OWNER, AUTHOR)
    assert entry.details == {
        "comment_id": str(comment.id),
        "document_id": str(DOCUMENT_ID),
        "target": "description",
        "target_document_id": str(DOCUMENT_ID),
        "from": "private",
        "to": "room",
        "newly_reached_user_ids": [str(reached[0])],
    }
    # Not widening is audited too, with nobody newly reached.
    assert _plan().audit_entry.details["newly_reached_user_ids"] == []


def test_widening_must_be_confirmed() -> None:
    with pytest.raises(PromotionWidensVisibilityError):
        _plan(newly_reached=(uuid.uuid4(),))


def test_only_a_manager_promotes_and_permission_is_checked_first() -> None:
    with pytest.raises(CannotPromoteCommentError):
        _plan(replace(_comment(), deleted_at=NOW), manages_document=False)
    with pytest.raises(CommentDeletedError):
        _plan(replace(_comment(), deleted_at=NOW))


def test_a_new_document_must_be_another_one_the_promoter_manages() -> None:
    with pytest.raises(PromotionIntoSameDocumentError):
        _plan(target=PromotionTarget.DOCUMENT, target_document_id=DOCUMENT_ID)
    with pytest.raises(CannotPromoteIntoDocumentError):
        _plan(
            target=PromotionTarget.DOCUMENT,
            target_document_id=NEW_DOCUMENT_ID,
            manages_target=False,
        )


def test_newly_reached_members_are_those_who_see_the_target_but_not_the_comment() -> None:
    def member(role: RoomRole = RoomRole.PLAYER) -> Membership:
        return Membership(
            id=uuid.uuid4(), room_id=ROOM_ID, user_id=uuid.uuid4(), role=role, is_admin=False
        )

    reader, outsider, blind = member(), member(), member()
    sees_comment = {reader.user_id}
    sees_target = {reader.user_id, outsider.user_id}

    reached = newly_reached_members(
        [reader, outsider, blind],
        lambda m: m.user_id in sees_comment,
        lambda m: m.user_id in sees_target,
    )

    assert reached == [outsider.user_id]

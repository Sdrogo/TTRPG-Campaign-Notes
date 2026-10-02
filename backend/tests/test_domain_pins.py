"""Pinning Comments and resolving their branch (spec 19c Decisions 3-4,
FR-T7): who may do it, on which Comments, and the per-Document pin limit."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.comments import (
    MAX_PINNED_PER_DOCUMENT,
    CannotPinCommentError,
    CannotResolveCommentError,
    CommentDeletedError,
    NotTopLevelCommentError,
    TooManyPinnedCommentsError,
    can_pin_comment,
    can_resolve_comment,
    plan_comment_deletion,
    plan_new_comment,
    plan_pin,
    plan_reopen,
    plan_resolve,
    plan_unpin,
)
from app.domain.models import Comment, DocumentVisibility, RoomRole

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=5)
DOCUMENT_ID = uuid.uuid4()
AUTHOR = uuid.uuid4()
OTHER = uuid.uuid4()


def _top_level() -> Comment:
    return plan_new_comment(DOCUMENT_ID, AUTHOR, "Who has the key?", DocumentVisibility.ROOM, NOW)


def _reply() -> Comment:
    return plan_new_comment(
        DOCUMENT_ID, AUTHOR, "The innkeeper.", DocumentVisibility.ROOM, NOW, parent=_top_level()
    )


def _deleted() -> Comment:
    return replace(_top_level(), body="", deleted_at=NOW)


# --- Pin (Decision 3) ---------------------------------------------------------


def test_an_owner_or_the_master_may_pin_a_top_level_comment() -> None:
    assert can_pin_comment(_top_level(), manages_document=True)
    # The author alone doesn't manage the Document.
    assert not can_pin_comment(_top_level(), manages_document=False)


def test_a_reply_or_a_deleted_placeholder_cannot_be_pinned() -> None:
    assert not can_pin_comment(_reply(), manages_document=True)
    assert not can_pin_comment(_deleted(), manages_document=True)


def test_pinning_stamps_the_time() -> None:
    pinned = plan_pin(_top_level(), manages_document=True, pinned_count=0, now=LATER)
    assert pinned.pinned_at == LATER


def test_pinning_a_pinned_comment_keeps_its_place_even_at_the_limit() -> None:
    pinned = replace(_top_level(), pinned_at=NOW)
    again = plan_pin(pinned, manages_document=True, pinned_count=MAX_PINNED_PER_DOCUMENT, now=LATER)
    assert again.pinned_at == NOW


def test_a_document_holds_at_most_three_pinned_comments() -> None:
    plan_pin(_top_level(), True, MAX_PINNED_PER_DOCUMENT - 1, LATER)
    with pytest.raises(TooManyPinnedCommentsError):
        plan_pin(_top_level(), True, MAX_PINNED_PER_DOCUMENT, LATER)


def test_only_a_manager_pins_and_permission_is_checked_first() -> None:
    with pytest.raises(CannotPinCommentError):
        plan_pin(_reply(), manages_document=False, pinned_count=0, now=LATER)
    with pytest.raises(NotTopLevelCommentError):
        plan_pin(_reply(), manages_document=True, pinned_count=0, now=LATER)
    with pytest.raises(CommentDeletedError):
        plan_pin(_deleted(), manages_document=True, pinned_count=0, now=LATER)


def test_unpinning_is_for_managers_and_idempotent() -> None:
    pinned = replace(_top_level(), pinned_at=NOW)
    assert plan_unpin(pinned, manages_document=True).pinned_at is None
    assert plan_unpin(_top_level(), manages_document=True).pinned_at is None
    with pytest.raises(CannotPinCommentError):
        plan_unpin(pinned, manages_document=False)


def test_deleting_a_comment_unpins_it_but_keeps_it_resolved() -> None:
    comment = replace(_top_level(), pinned_at=NOW, resolved_at=NOW, resolved_by=OTHER)
    deleted = plan_comment_deletion(comment, AUTHOR, RoomRole.PLAYER, LATER)
    assert deleted.pinned_at is None
    assert (deleted.resolved_at, deleted.resolved_by) == (NOW, OTHER)


# --- Resolved (Decision 4) ----------------------------------------------------


def test_the_author_an_owner_or_the_master_may_resolve_a_branch() -> None:
    comment = _top_level()
    assert can_resolve_comment(comment, AUTHOR, manages_document=False)
    assert can_resolve_comment(comment, OTHER, manages_document=True)
    assert not can_resolve_comment(comment, OTHER, manages_document=False)


def test_a_reply_has_no_branch_of_its_own_to_resolve() -> None:
    assert not can_resolve_comment(_reply(), AUTHOR, manages_document=True)
    with pytest.raises(NotTopLevelCommentError):
        plan_resolve(_reply(), AUTHOR, manages_document=False, now=LATER)
    with pytest.raises(NotTopLevelCommentError):
        plan_reopen(_reply(), AUTHOR, manages_document=False)


def test_a_deleted_top_level_comment_still_heads_a_branch_to_resolve() -> None:
    assert can_resolve_comment(_deleted(), OTHER, manages_document=True)
    assert plan_resolve(_deleted(), OTHER, True, LATER).resolved_at == LATER


def test_resolving_records_who_and_when_and_keeps_the_first() -> None:
    resolved = plan_resolve(_top_level(), OTHER, manages_document=True, now=NOW)
    assert (resolved.resolved_at, resolved.resolved_by) == (NOW, OTHER)
    again = plan_resolve(resolved, AUTHOR, manages_document=False, now=LATER)
    assert (again.resolved_at, again.resolved_by) == (NOW, OTHER)


def test_reopening_clears_the_resolution_and_is_idempotent() -> None:
    resolved = plan_resolve(_top_level(), AUTHOR, manages_document=False, now=NOW)
    reopened = plan_reopen(resolved, AUTHOR, manages_document=False)
    assert (reopened.resolved_at, reopened.resolved_by) == (None, None)
    assert plan_reopen(reopened, OTHER, manages_document=True).resolved_at is None


def test_anyone_else_may_neither_resolve_nor_reopen() -> None:
    with pytest.raises(CannotResolveCommentError):
        plan_resolve(_top_level(), OTHER, manages_document=False, now=LATER)
    with pytest.raises(CannotResolveCommentError):
        plan_reopen(_top_level(), OTHER, manages_document=False)

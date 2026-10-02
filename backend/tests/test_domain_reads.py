"""Unread Comments (spec 19b): what counts as new, and counts that never
reveal a hidden post (VR-07)."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from app.domain.comments import plan_new_comment
from app.domain.models import Comment, DocumentVisibility, RoomRole
from app.domain.reads import is_unread, unread_counts

READ_AT = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
BEFORE = READ_AT - timedelta(minutes=5)
AFTER = READ_AT + timedelta(minutes=5)
DOCUMENT_ID = uuid.uuid4()
OTHER_DOCUMENT_ID = uuid.uuid4()
VIEWER = uuid.uuid4()
AUTHOR = uuid.uuid4()
MASTER = uuid.uuid4()


def _comment(
    author: uuid.UUID = AUTHOR,
    created_at: datetime = AFTER,
    visibility: DocumentVisibility = DocumentVisibility.ROOM,
    parent: Comment | None = None,
    document_id: uuid.UUID = DOCUMENT_ID,
) -> Comment:
    return plan_new_comment(
        document_id, author, "The mists part.", visibility, created_at, parent=parent
    )


def _counts(
    comments: list[Comment],
    viewer: uuid.UUID = VIEWER,
    role: RoomRole = RoomRole.PLAYER,
    last_read: dict[uuid.UUID, datetime] | None = None,
    grants: dict[uuid.UUID, list[uuid.UUID]] | None = None,
) -> dict[uuid.UUID, int | None]:
    return unread_counts(
        [DOCUMENT_ID, OTHER_DOCUMENT_ID],
        {DOCUMENT_ID: READ_AT} if last_read is None else last_read,
        comments,
        {comment.id: comment for comment in comments},
        grants or {},
        viewer,
        role,
    )


# --- What counts as new (Decision 1) ---------------------------------------


def test_a_comment_by_someone_else_after_the_visit_is_unread() -> None:
    assert is_unread(_comment(), READ_AT, VIEWER)


def test_a_comment_from_before_the_visit_is_not_unread() -> None:
    assert not is_unread(_comment(created_at=BEFORE), READ_AT, VIEWER)


def test_own_comments_are_never_unread() -> None:
    assert not is_unread(_comment(author=VIEWER), READ_AT, VIEWER)


def test_a_deleted_comment_is_not_unread() -> None:
    deleted = replace(_comment(), deleted_at=AFTER)
    assert not is_unread(deleted, READ_AT, VIEWER)


def test_an_edit_after_the_visit_does_not_make_an_old_comment_unread() -> None:
    edited = replace(_comment(created_at=BEFORE), updated_at=AFTER)
    assert not is_unread(edited, READ_AT, VIEWER)


def test_nothing_is_unread_on_a_document_never_opened() -> None:
    # Decision 4: the client shows "not yet read" instead of a count.
    assert not is_unread(_comment(), None, VIEWER)


# --- Counts per Document ----------------------------------------------------


def test_counts_new_comments_and_replies_per_document() -> None:
    top = _comment(created_at=BEFORE)
    reply = _comment(parent=top)
    other = _comment(document_id=OTHER_DOCUMENT_ID)

    counts = _counts(
        [top, reply, _comment(), other],
        last_read={DOCUMENT_ID: READ_AT, OTHER_DOCUMENT_ID: READ_AT},
    )

    assert counts == {DOCUMENT_ID: 2, OTHER_DOCUMENT_ID: 1}


def test_a_document_never_opened_has_no_count() -> None:
    counts = _counts([_comment(), _comment(document_id=OTHER_DOCUMENT_ID)])
    assert counts == {DOCUMENT_ID: 1, OTHER_DOCUMENT_ID: None}


def test_a_read_document_with_nothing_new_counts_zero() -> None:
    assert _counts([_comment(created_at=BEFORE)])[DOCUMENT_ID] == 0


def test_comments_on_documents_outside_the_list_are_ignored() -> None:
    stray = _comment(document_id=uuid.uuid4())
    assert _counts([stray])[DOCUMENT_ID] == 0


def test_a_comment_the_viewer_cannot_see_is_never_counted() -> None:
    # VR-07: the count must not reveal a Master-only post to a Player.
    hidden = _comment(author=MASTER, visibility=DocumentVisibility.MASTER)
    assert _counts([hidden])[DOCUMENT_ID] == 0


def test_a_reply_under_a_hidden_parent_is_never_counted() -> None:
    # The reply is Room-wide on its own, but its parent is Master-only:
    # effective visibility (spec 19) hides it, so it isn't counted either.
    parent = _comment(author=MASTER, visibility=DocumentVisibility.MASTER, created_at=BEFORE)
    reply = _comment(author=MASTER, visibility=DocumentVisibility.ROOM, parent=parent)
    assert _counts([parent, reply])[DOCUMENT_ID] == 0


def test_a_selective_comment_counts_for_its_grantees_only() -> None:
    selective = _comment(visibility=DocumentVisibility.SELECTIVE)
    grants = {selective.id: [VIEWER]}

    assert _counts([selective], grants=grants)[DOCUMENT_ID] == 1
    assert _counts([selective], viewer=uuid.uuid4(), grants=grants)[DOCUMENT_ID] == 0


def test_the_master_counts_everything_new() -> None:
    hidden = _comment(visibility=DocumentVisibility.PRIVATE)
    assert _counts([hidden], viewer=MASTER, role=RoomRole.MASTER)[DOCUMENT_ID] == 1

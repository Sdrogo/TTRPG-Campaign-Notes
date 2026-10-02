"""Threaded replies (spec 19): what a reply may answer, how wide it may be,
and its effective visibility through the Comments above it."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.domain.comments import (
    ParentCommentDeletedError,
    ParentCommentNotFoundError,
    ReplyWiderThanParentError,
    ensure_not_wider,
    plan_new_comment,
)
from app.domain.models import Comment, DocumentImage, DocumentVisibility, Membership, RoomRole
from app.domain.visibility import (
    is_comment_visible_in_thread,
    is_parent_hidden,
    visible_document_images,
)

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
ROOM_ID = uuid.uuid4()
DOCUMENT_ID = uuid.uuid4()
MASTER = uuid.uuid4()
PARENT_AUTHOR = uuid.uuid4()
REPLY_AUTHOR = uuid.uuid4()
GRANTED = uuid.uuid4()
OTHER = uuid.uuid4()

ROOM = DocumentVisibility.ROOM
MASTER_ONLY = DocumentVisibility.MASTER
PRIVATE = DocumentVisibility.PRIVATE
SELECTIVE = DocumentVisibility.SELECTIVE


def _membership(user_id: uuid.UUID, role: RoomRole = RoomRole.PLAYER) -> Membership:
    return Membership(id=uuid.uuid4(), room_id=ROOM_ID, user_id=user_id, role=role, is_admin=False)


MEMBERS = [
    _membership(MASTER, RoomRole.MASTER),
    _membership(PARENT_AUTHOR),
    _membership(REPLY_AUTHOR),
    _membership(GRANTED),
    _membership(OTHER),
]


def _comment(
    author: uuid.UUID = PARENT_AUTHOR,
    visibility: DocumentVisibility = ROOM,
    parent: Comment | None = None,
) -> Comment:
    return plan_new_comment(DOCUMENT_ID, author, "Who goes there?", visibility, NOW, parent=parent)


# --- Answering a Comment ---------------------------------------------------


def test_a_reply_records_the_comment_it_answers() -> None:
    parent = _comment()
    reply = _comment(REPLY_AUTHOR, parent=parent)
    assert reply.parent_id == parent.id
    assert _comment().parent_id is None


def test_a_comment_of_another_document_cannot_be_answered() -> None:
    elsewhere = replace(_comment(), document_id=uuid.uuid4())
    with pytest.raises(ParentCommentNotFoundError):
        _comment(REPLY_AUTHOR, parent=elsewhere)


def test_a_deleted_comment_cannot_be_answered() -> None:
    deleted = replace(_comment(), body="", deleted_at=NOW)
    with pytest.raises(ParentCommentDeletedError):
        _comment(REPLY_AUTHOR, parent=deleted)


# --- Never wider than the parent (VR-04, I-09) ------------------------------


@pytest.mark.parametrize(
    ("parent_level", "parent_grants", "reply_level", "reply_grants", "allowed"),
    [
        # A Room parent takes any reply.
        (ROOM, [], ROOM, [], True),
        (ROOM, [], SELECTIVE, [OTHER], True),
        (ROOM, [], MASTER_ONLY, [], True),
        (ROOM, [], PRIVATE, [], True),
        # Master only: seen by the Master and its author.
        (MASTER_ONLY, [], ROOM, [], False),
        (MASTER_ONLY, [], MASTER_ONLY, [], True),
        (MASTER_ONLY, [], PRIVATE, [], True),
        (MASTER_ONLY, [], SELECTIVE, [PARENT_AUTHOR], True),
        (MASTER_ONLY, [], SELECTIVE, [OTHER], False),
        # Private: the same audience for the Players.
        (PRIVATE, [], ROOM, [], False),
        (PRIVATE, [], MASTER_ONLY, [], True),
        (PRIVATE, [], PRIVATE, [], True),
        (PRIVATE, [], SELECTIVE, [PARENT_AUTHOR], True),
        (PRIVATE, [], SELECTIVE, [GRANTED], False),
        # Selective: a subset of its readers, never anyone else.
        (SELECTIVE, [GRANTED, REPLY_AUTHOR], ROOM, [], False),
        (SELECTIVE, [GRANTED, REPLY_AUTHOR], SELECTIVE, [GRANTED], True),
        (SELECTIVE, [GRANTED, REPLY_AUTHOR], SELECTIVE, [GRANTED, PARENT_AUTHOR], True),
        (SELECTIVE, [GRANTED, REPLY_AUTHOR], SELECTIVE, [GRANTED, OTHER], False),
        (SELECTIVE, [GRANTED, REPLY_AUTHOR], MASTER_ONLY, [], True),
        (SELECTIVE, [GRANTED, REPLY_AUTHOR], PRIVATE, [], True),
    ],
)
def test_a_reply_audience_must_fit_inside_its_parent(
    parent_level: DocumentVisibility,
    parent_grants: list[uuid.UUID],
    reply_level: DocumentVisibility,
    reply_grants: list[uuid.UUID],
    allowed: bool,
) -> None:
    parent = _comment(visibility=parent_level)
    if allowed:
        ensure_not_wider(REPLY_AUTHOR, reply_level, reply_grants, parent, parent_grants, MEMBERS)
    else:
        with pytest.raises(ReplyWiderThanParentError):
            ensure_not_wider(
                REPLY_AUTHOR, reply_level, reply_grants, parent, parent_grants, MEMBERS
            )


def test_the_reply_author_is_not_counted_against_the_parent() -> None:
    # The parent was narrowed past the reply's author; they may still keep
    # their reply to themselves (VR-02: they always see it).
    parent = _comment(visibility=PRIVATE)
    ensure_not_wider(REPLY_AUTHOR, PRIVATE, [], parent, [], MEMBERS)
    ensure_not_wider(REPLY_AUTHOR, SELECTIVE, [REPLY_AUTHOR], parent, [], MEMBERS)


# --- Effective visibility ---------------------------------------------------


def _thread(*comments: Comment) -> dict[uuid.UUID, Comment]:
    return {comment.id: comment for comment in comments}


def _sees(
    comment: Comment,
    thread: dict[uuid.UUID, Comment],
    viewer: uuid.UUID,
    role: RoomRole = RoomRole.PLAYER,
    grants: dict[uuid.UUID, list[uuid.UUID]] | None = None,
) -> bool:
    return is_comment_visible_in_thread(comment, thread, grants or {}, viewer, role)


def test_a_reply_is_seen_when_its_parent_is() -> None:
    top = _comment()
    reply = _comment(REPLY_AUTHOR, parent=top)
    assert _sees(reply, _thread(top, reply), OTHER) is True


def test_narrowing_a_comment_hides_its_whole_branch() -> None:
    top = _comment(MASTER, visibility=MASTER_ONLY)
    reply = _comment(REPLY_AUTHOR, parent=top)
    deeper = _comment(GRANTED, parent=reply)
    thread = _thread(top, reply, deeper)

    assert _sees(reply, thread, OTHER) is False
    assert _sees(deeper, thread, OTHER) is False
    # The Master sees everything (I-03).
    assert _sees(deeper, thread, OTHER, RoomRole.MASTER) is True


def test_a_reply_still_needs_its_own_visibility() -> None:
    top = _comment()
    reply = _comment(REPLY_AUTHOR, visibility=SELECTIVE, parent=top)
    thread = _thread(top, reply)
    assert _sees(reply, thread, OTHER) is False
    assert _sees(reply, thread, OTHER, grants={reply.id: [OTHER]}) is True


def test_the_author_always_sees_their_reply_under_a_hidden_parent() -> None:
    top = _comment(MASTER, visibility=MASTER_ONLY)
    reply = _comment(REPLY_AUTHOR, parent=top)
    thread = _thread(top, reply)

    assert _sees(reply, thread, REPLY_AUTHOR) is True
    assert is_parent_hidden(reply, thread, {}, REPLY_AUTHOR, RoomRole.PLAYER) is True
    assert is_parent_hidden(reply, thread, {}, MASTER, RoomRole.MASTER) is False


def test_replies_under_a_comment_the_viewer_wrote_follow_it() -> None:
    # The grandparent is hidden from the parent's author, but they always see
    # their own Comment, so a reply to it is visible to them too.
    top = _comment(MASTER, visibility=MASTER_ONLY)
    middle = _comment(PARENT_AUTHOR, parent=top)
    reply = _comment(OTHER, parent=middle)
    thread = _thread(top, middle, reply)

    assert _sees(reply, thread, PARENT_AUTHOR) is True
    assert is_parent_hidden(reply, thread, {}, PARENT_AUTHOR, RoomRole.PLAYER) is False
    assert _sees(reply, thread, GRANTED) is False


def test_a_missing_ancestor_counts_as_hidden() -> None:
    top = _comment()
    reply = _comment(REPLY_AUTHOR, parent=top)
    orphans = _thread(reply)
    assert _sees(reply, orphans, OTHER) is False
    assert is_parent_hidden(reply, orphans, {}, REPLY_AUTHOR, RoomRole.PLAYER) is True


def test_a_top_level_comment_has_no_hidden_parent() -> None:
    top = _comment()
    assert is_parent_hidden(top, _thread(top), {}, OTHER, RoomRole.PLAYER) is False


def test_gallery_hides_images_of_a_reply_under_a_hidden_comment() -> None:
    top = _comment(MASTER, visibility=MASTER_ONLY)
    reply = _comment(MASTER, parent=top)
    image = DocumentImage(
        id=uuid.uuid4(),
        document_id=DOCUMENT_ID,
        storage_path="x.webp",
        created_by=MASTER,
        post_id=reply.id,
    )
    thread = _thread(top, reply)

    assert visible_document_images([image], thread, {}, OTHER, RoomRole.PLAYER) == []
    widened = _thread(replace(top, visibility=ROOM), reply)
    assert visible_document_images([image], widened, {}, OTHER, RoomRole.PLAYER) == [image]

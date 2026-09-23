import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.comments import (
    COMMENT_VISIBILITY_CHANGED,
    MAX_COMMENT_LENGTH,
    MAX_IMAGES_PER_COMMENT,
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
from app.domain.documents import plan_new_image
from app.domain.models import Comment, DocumentImage, DocumentVisibility, RoomRole
from app.domain.visibility import is_comment_visible, visible_document_images

NOW = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=5)
ROOM_ID = uuid.uuid4()
AUTHOR = uuid.uuid4()
OTHER = uuid.uuid4()


def _comment(visibility: DocumentVisibility = DocumentVisibility.ROOM) -> Comment:
    return plan_new_comment(uuid.uuid4(), AUTHOR, "The door creaks.", visibility, NOW)


def test_new_comment_strips_body_and_stamps_both_timestamps() -> None:
    comment = plan_new_comment(uuid.uuid4(), AUTHOR, "  Hello  ", DocumentVisibility.ROOM, NOW)
    assert comment.body == "Hello"
    assert comment.created_at == comment.updated_at == NOW
    assert comment.deleted_at is None


@pytest.mark.parametrize("body", ["", "   ", "\n\t"])
def test_new_comment_rejects_blank_body(body: str) -> None:
    with pytest.raises(CommentBodyRequiredError):
        plan_new_comment(uuid.uuid4(), AUTHOR, body, DocumentVisibility.ROOM, NOW)


def test_new_comment_rejects_overlong_body() -> None:
    with pytest.raises(CommentTooLongError):
        plan_new_comment(
            uuid.uuid4(), AUTHOR, "x" * (MAX_COMMENT_LENGTH + 1), DocumentVisibility.ROOM, NOW
        )


def test_only_author_can_edit_not_even_master() -> None:
    comment = _comment()
    assert can_edit_comment(comment, AUTHOR)
    assert not can_edit_comment(comment, OTHER)
    with pytest.raises(NotCommentAuthorError):
        plan_comment_edit(comment, ROOM_ID, OTHER, LATER, body="Hijacked")


def test_edit_updates_body_and_timestamp_without_audit_when_visibility_unchanged() -> None:
    plan = plan_comment_edit(_comment(), ROOM_ID, AUTHOR, LATER, body="Edited")
    assert plan.comment.body == "Edited"
    assert plan.comment.updated_at == LATER
    assert plan.comment.created_at == NOW
    assert plan.audit_entry is None


def test_edit_rejects_blank_body() -> None:
    with pytest.raises(CommentBodyRequiredError):
        plan_comment_edit(_comment(), ROOM_ID, AUTHOR, LATER, body="  ")


def test_visibility_change_writes_audit_entry() -> None:
    comment = _comment()
    plan = plan_comment_edit(comment, ROOM_ID, AUTHOR, LATER, visibility=DocumentVisibility.PRIVATE)
    assert plan.audit_entry is not None
    assert plan.audit_entry.action == COMMENT_VISIBILITY_CHANGED
    assert plan.audit_entry.room_id == ROOM_ID
    assert plan.audit_entry.details["from"] == "room"
    assert plan.audit_entry.details["to"] == "private"
    assert plan.audit_entry.details["comment_id"] == str(comment.id)


def test_selective_grant_change_writes_audit_entry() -> None:
    comment = _comment(DocumentVisibility.SELECTIVE)
    plan = plan_comment_edit(
        comment, ROOM_ID, AUTHOR, LATER, current_selective_ids=[], new_selective_ids=[OTHER]
    )
    assert plan.audit_entry is not None
    assert plan.audit_entry.details["selective_user_ids"] == [str(OTHER)]


def test_unchanged_selective_grants_write_no_audit_entry() -> None:
    comment = _comment(DocumentVisibility.SELECTIVE)
    plan = plan_comment_edit(
        comment, ROOM_ID, AUTHOR, LATER, current_selective_ids=[OTHER], new_selective_ids=[OTHER]
    )
    assert plan.audit_entry is None


def test_author_and_master_can_delete_other_player_cannot() -> None:
    comment = _comment()
    assert can_delete_comment(comment, AUTHOR, RoomRole.PLAYER)
    assert can_delete_comment(comment, OTHER, RoomRole.MASTER)
    assert not can_delete_comment(comment, OTHER, RoomRole.PLAYER)
    with pytest.raises(CannotDeleteCommentError):
        plan_comment_deletion(comment, OTHER, RoomRole.PLAYER, LATER)


def test_deletion_leaves_an_emptied_placeholder() -> None:
    deleted = plan_comment_deletion(_comment(), AUTHOR, RoomRole.PLAYER, LATER)
    assert deleted.body == ""
    assert deleted.deleted_at == LATER


def test_deleted_comment_cannot_be_edited_or_deleted_again() -> None:
    deleted = plan_comment_deletion(_comment(), AUTHOR, RoomRole.PLAYER, LATER)
    assert not can_edit_comment(deleted, AUTHOR)
    assert not can_delete_comment(deleted, AUTHOR, RoomRole.MASTER)
    with pytest.raises(CommentDeletedError):
        plan_comment_edit(deleted, ROOM_ID, AUTHOR, LATER, body="Back from the dead")
    with pytest.raises(CommentDeletedError):
        plan_comment_deletion(deleted, AUTHOR, RoomRole.PLAYER, LATER)


# Comment visibility truth table (VR-01/VR-03): (level, viewer, role, grants) -> visible.
@pytest.mark.parametrize(
    ("visibility", "viewer", "role", "granted", "expected"),
    [
        (DocumentVisibility.ROOM, OTHER, RoomRole.PLAYER, False, True),
        (DocumentVisibility.MASTER, OTHER, RoomRole.PLAYER, False, False),
        (DocumentVisibility.MASTER, OTHER, RoomRole.MASTER, False, True),
        (DocumentVisibility.MASTER, AUTHOR, RoomRole.PLAYER, False, True),
        (DocumentVisibility.PRIVATE, OTHER, RoomRole.PLAYER, False, False),
        (DocumentVisibility.PRIVATE, AUTHOR, RoomRole.PLAYER, False, True),
        (DocumentVisibility.PRIVATE, OTHER, RoomRole.MASTER, False, True),
        (DocumentVisibility.SELECTIVE, OTHER, RoomRole.PLAYER, False, False),
        (DocumentVisibility.SELECTIVE, OTHER, RoomRole.PLAYER, True, True),
        (DocumentVisibility.SELECTIVE, AUTHOR, RoomRole.PLAYER, False, True),
    ],
)
def test_comment_visibility(
    visibility: DocumentVisibility,
    viewer: uuid.UUID,
    role: RoomRole,
    granted: bool,
    expected: bool,
) -> None:
    comment = replace(_comment(), visibility=visibility)
    grants = [viewer] if granted else []
    assert is_comment_visible(comment, viewer, role, grants) is expected


# --- Comment images -------------------------------------------------------


def test_author_can_attach_images_up_to_the_per_comment_limit() -> None:
    comment = _comment()
    ensure_can_attach_image(comment, AUTHOR, MAX_IMAGES_PER_COMMENT - 1)
    with pytest.raises(TooManyCommentImagesError):
        ensure_can_attach_image(comment, AUTHOR, MAX_IMAGES_PER_COMMENT)


def test_only_author_can_attach_or_detach_images() -> None:
    comment = _comment()
    with pytest.raises(NotCommentAuthorError):
        ensure_can_attach_image(comment, OTHER, 0)
    with pytest.raises(NotCommentAuthorError):
        ensure_can_detach_image(comment, OTHER)
    ensure_can_detach_image(comment, AUTHOR)


def test_deleted_comment_takes_no_image_changes() -> None:
    deleted = plan_comment_deletion(_comment(), AUTHOR, RoomRole.PLAYER, LATER)
    with pytest.raises(CommentDeletedError):
        ensure_can_attach_image(deleted, AUTHOR, 0)
    with pytest.raises(CommentDeletedError):
        ensure_can_detach_image(deleted, AUTHOR)


def test_plan_new_image_links_the_comment() -> None:
    comment = _comment()
    image = plan_new_image(ROOM_ID, comment.document_id, ".webp", AUTHOR, 0, post_id=comment.id)
    assert image.post_id == comment.id
    assert image.storage_path.startswith(f"{ROOM_ID}/{comment.document_id}/")


def _image(post_id: uuid.UUID | None) -> DocumentImage:
    return DocumentImage(
        id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        storage_path="x.webp",
        created_by=AUTHOR,
        post_id=post_id,
    )


def test_gallery_hides_images_of_comments_the_viewer_cannot_see() -> None:
    public = _comment(DocumentVisibility.ROOM)
    private = _comment(DocumentVisibility.PRIVATE)
    own_image = _image(None)
    public_image = _image(public.id)
    private_image = _image(private.id)
    images = [own_image, public_image, private_image]
    comments = {public.id: public, private.id: private}

    as_other = visible_document_images(images, comments, {}, OTHER, RoomRole.PLAYER)
    assert as_other == [own_image, public_image]
    as_author = visible_document_images(images, comments, {}, AUTHOR, RoomRole.PLAYER)
    assert as_author == images
    as_master = visible_document_images(images, comments, {}, OTHER, RoomRole.MASTER)
    assert as_master == images


def test_gallery_respects_selective_grants_and_hides_orphans_and_deleted() -> None:
    selective = _comment(DocumentVisibility.SELECTIVE)
    deleted = plan_comment_deletion(_comment(), AUTHOR, RoomRole.PLAYER, LATER)
    granted = _image(selective.id)
    images = [granted, _image(deleted.id), _image(uuid.uuid4())]
    comments = {selective.id: selective, deleted.id: deleted}

    assert visible_document_images(images, comments, {}, OTHER, RoomRole.PLAYER) == []
    assert visible_document_images(
        images, comments, {selective.id: [OTHER]}, OTHER, RoomRole.PLAYER
    ) == [granted]

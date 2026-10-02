"""Unread Comments (spec 19b, FR-T4): what is new to a member since they last
opened a Document. No real-time (D-04): counts are recomputed on each read of
the Documents list."""

import uuid
from collections.abc import Collection, Iterable, Mapping
from datetime import datetime

from app.domain.models import Comment, RoomRole
from app.domain.visibility import is_comment_visible_in_thread


def is_unread(comment: Comment, last_read_at: datetime | None, viewer_user_id: uuid.UUID) -> bool:
    """Whether a Comment (or reply) is new to the viewer, visibility aside
    (spec 19b Decision 1): created after their last visit, by someone else,
    and not deleted. Edits don't count, and neither does a post that only
    became visible later, since it was not created after the visit. A
    Document never opened (`last_read_at` None) has nothing "new": the
    client shows "not yet read" instead (Decision 4)."""
    return (
        last_read_at is not None
        and comment.created_at > last_read_at
        and comment.author_id != viewer_user_id
        and comment.deleted_at is None
    )


def unread_counts(
    document_ids: Iterable[uuid.UUID],
    last_read_by_document: Mapping[uuid.UUID, datetime],
    candidates: Iterable[Comment],
    comments_by_id: Mapping[uuid.UUID, Comment],
    grants_by_comment: Mapping[uuid.UUID, Collection[uuid.UUID]],
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
) -> dict[uuid.UUID, int | None]:
    """The number of unread Comments on each Document, or None for one the
    viewer never opened (spec 19b Decision 4). A Comment counts only when
    the viewer sees it through its whole parent chain
    (`is_comment_visible_in_thread`), so no count can reveal a hidden post
    (VR-07); the Master sees, and so counts, everything (VR-01).
    `candidates` may hold more than the unread Comments (they are filtered
    here); `comments_by_id` must hold their ancestors too."""
    counts: dict[uuid.UUID, int | None] = {
        document_id: 0 if document_id in last_read_by_document else None
        for document_id in document_ids
    }
    for comment in candidates:
        current = counts.get(comment.document_id)
        if current is None:
            continue
        if not is_unread(comment, last_read_by_document.get(comment.document_id), viewer_user_id):
            continue
        if not is_comment_visible_in_thread(
            comment, comments_by_id, grants_by_comment, viewer_user_id, viewer_role
        ):
            continue
        counts[comment.document_id] = current + 1
    return counts

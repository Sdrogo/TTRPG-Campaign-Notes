import uuid
from collections.abc import Collection, Iterable, Mapping

from app.domain.models import Comment, Document, DocumentImage, DocumentVisibility, RoomRole


def is_content_visible(
    visibility: DocumentVisibility,
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
    owner_user_ids: Collection[uuid.UUID],
    selective_user_ids: Collection[uuid.UUID],
) -> bool:
    """Section 8 of requirements.md, for any content with a visibility
    level. "Owner" is whoever owns that content: a Document's Owners, a
    Post's author. The Master always sees everything in their Room (VR-01)."""
    if viewer_role == RoomRole.MASTER:
        return True

    match visibility:
        case DocumentVisibility.ROOM:
            return True
        case DocumentVisibility.MASTER:
            return False
        case DocumentVisibility.PRIVATE:
            return viewer_user_id in owner_user_ids
        case DocumentVisibility.SELECTIVE:
            return viewer_user_id in owner_user_ids or viewer_user_id in selective_user_ids


def is_document_visible(
    document: Document,
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
    owner_user_ids: Collection[uuid.UUID],
    selective_user_ids: Collection[uuid.UUID],
) -> bool:
    """VR-01/VR-03: the visibility filter every read path must apply
    (Invariant 1) before a Document reaches the client."""
    return is_content_visible(
        document.visibility, viewer_user_id, viewer_role, owner_user_ids, selective_user_ids
    )


def is_comment_visible(
    comment: Comment,
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
    selective_user_ids: Collection[uuid.UUID],
) -> bool:
    """VR-03 for a Comment. Only meaningful once the viewer is known to see
    the Comment's Document - a Comment is never reachable without it. The
    author always sees their own Comment, even at "Solo Master" (VR-02: the
    level restricts other Players, not the one who wrote it)."""
    if viewer_user_id == comment.author_id:
        return True
    return is_content_visible(
        comment.visibility, viewer_user_id, viewer_role, {comment.author_id}, selective_user_ids
    )


def visible_document_images(
    images: Iterable[DocumentImage],
    comments_by_id: Mapping[uuid.UUID, Comment],
    grants_by_comment: Mapping[uuid.UUID, Collection[uuid.UUID]],
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
) -> list[DocumentImage]:
    """A Document's images, filtered for one viewer (Invariant 1). An image
    attached to a Comment inherits that Comment's visibility (VR-03), so a
    Private Comment's image never shows up in the Document gallery of
    someone who can't read the Comment. Images of a deleted Comment are
    removed with it; one whose Comment is missing is treated as hidden."""
    visible = []
    for image in images:
        if image.post_id is not None:
            comment = comments_by_id.get(image.post_id)
            if comment is None or comment.deleted_at is not None:
                continue
            grants = grants_by_comment.get(comment.id, ())
            if not is_comment_visible(comment, viewer_user_id, viewer_role, grants):
                continue
        visible.append(image)
    return visible

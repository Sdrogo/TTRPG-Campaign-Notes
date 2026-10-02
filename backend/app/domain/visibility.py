"""The visibility filter (section 8 of requirements.md, VR-01 to VR-07). Every
read path passes Room content through here before it reaches the client
(Invariant 1)."""

import uuid
from collections.abc import Collection, Iterable, Mapping

from app.domain.models import (
    Comment,
    Document,
    DocumentImage,
    DocumentVisibility,
    Note,
    RoomRole,
)


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


def is_comment_visible_in_thread(
    comment: Comment,
    comments_by_id: Mapping[uuid.UUID, Comment],
    grants_by_comment: Mapping[uuid.UUID, Collection[uuid.UUID]],
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
) -> bool:
    """The effective visibility of a Comment (spec 19, D-17, VR-04, I-09): a
    reply is seen only by who sees it on its own (`is_comment_visible`) and
    sees its parent too, up to the top-level Comment. So narrowing a Comment
    hides its whole branch without touching the replies' rows, and widening
    it back restores them as their authors left them. The author of a reply
    always sees it (VR-02, spec 19 Decision 6), whatever happened above it.
    `comments_by_id` must hold every ancestor (`get_comments_with_ancestors`);
    a missing one is treated as hidden. Every read path of a Comment, and of
    an image attached to one, goes through here (Invariant 1)."""
    current: Comment | None = comment
    while current is not None:
        grants = grants_by_comment.get(current.id, ())
        if not is_comment_visible(current, viewer_user_id, viewer_role, grants):
            return False
        if viewer_user_id == current.author_id or current.parent_id is None:
            return True
        current = comments_by_id.get(current.parent_id)
    return False


def is_parent_hidden(
    comment: Comment,
    comments_by_id: Mapping[uuid.UUID, Comment],
    grants_by_comment: Mapping[uuid.UUID, Collection[uuid.UUID]],
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
) -> bool:
    """Whether a reply the viewer sees answers a Comment they don't (spec 19
    Decision 6). Only the reply's own author can be in that position: the
    client then draws a "parent hidden" placeholder, and the response withholds
    `parent_id` so nothing about the parent leaks."""
    if comment.parent_id is None:
        return False
    parent = comments_by_id.get(comment.parent_id)
    return parent is None or not is_comment_visible_in_thread(
        parent, comments_by_id, grants_by_comment, viewer_user_id, viewer_role
    )


def is_note_visible(
    note: Note,
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
    document_owner_ids: Collection[uuid.UUID],
    selective_user_ids: Collection[uuid.UUID],
) -> bool:
    """VR-03 for a Note. Only meaningful once the viewer is known to see the
    Note's Document. A Note has no author of its own in the visibility sense:
    "Private" means the Document's Owners (and the Master), like the
    Document itself."""
    return is_content_visible(
        note.visibility, viewer_user_id, viewer_role, document_owner_ids, selective_user_ids
    )


def visible_document_images(
    images: Iterable[DocumentImage],
    comments_by_id: Mapping[uuid.UUID, Comment],
    grants_by_comment: Mapping[uuid.UUID, Collection[uuid.UUID]],
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
) -> list[DocumentImage]:
    """A Document's images, filtered for one viewer (Invariant 1). An image
    attached to a Comment inherits that Comment's effective visibility (VR-03,
    spec 19), so a Private Comment's image, or one of a reply under a Comment
    the viewer can't read, never shows up in their Document gallery.
    `comments_by_id` must hold the Comments' ancestors too. Images of a
    deleted Comment are removed with it; one whose Comment is missing is
    treated as hidden."""
    visible = []
    for image in images:
        if image.post_id is not None:
            comment = comments_by_id.get(image.post_id)
            if comment is None or comment.deleted_at is not None:
                continue
            if not is_comment_visible_in_thread(
                comment, comments_by_id, grants_by_comment, viewer_user_id, viewer_role
            ):
                continue
        visible.append(image)
    return visible

import uuid
from collections.abc import Collection

from app.domain.models import Document, DocumentVisibility, RoomRole


def is_document_visible(
    document: Document,
    viewer_user_id: uuid.UUID,
    viewer_role: RoomRole,
    owner_user_ids: Collection[uuid.UUID],
    selective_user_ids: Collection[uuid.UUID],
) -> bool:
    """VR-01/VR-03: the visibility filter every read path must apply
    (Invariant 1) before a Document reaches the client. The Master always
    sees everything in their Room, regardless of the Document's level."""
    if viewer_role == RoomRole.MASTER:
        return True

    match document.visibility:
        case DocumentVisibility.ROOM:
            return True
        case DocumentVisibility.MASTER:
            return False
        case DocumentVisibility.PRIVATE:
            return viewer_user_id in owner_user_ids
        case DocumentVisibility.SELECTIVE:
            return viewer_user_id in owner_user_ids or viewer_user_id in selective_user_ids

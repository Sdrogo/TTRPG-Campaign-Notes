import uuid
from collections.abc import Collection
from dataclasses import dataclass

from app.domain.models import (
    Document,
    DocumentImage,
    DocumentOwner,
    DocumentVisibility,
    RoomRole,
)

MAX_IMAGES_PER_DOCUMENT = 20


class DocumentNameRequiredError(Exception):
    pass


class TooManyImagesError(Exception):
    pass


class NotOwnerError(Exception):
    pass


class AlreadyOwnerError(Exception):
    pass


class NotAnOwnerError(Exception):
    pass


@dataclass(frozen=True)
class NewDocumentPlan:
    document: Document
    owner: DocumentOwner


def can_create_document(role: RoomRole, players_can_create_documents: bool) -> bool:
    """D-13/FR-D7: the Master can always create Documents; a Player can only
    when the Room hasn't disabled it."""
    return role == RoomRole.MASTER or players_can_create_documents


def plan_new_document(
    room_id: uuid.UUID,
    name: str,
    description: str,
    visibility: DocumentVisibility,
    creator_id: uuid.UUID,
) -> NewDocumentPlan:
    """UC-06: the creator becomes Owner. Whether they were allowed to create
    a Document at all (D-13/FR-D7) is checked by the caller against the
    Room's `players_can_create_documents` setting and the creator's role,
    before this is called - that's a Room-level policy, not something about
    the Document being planned here."""
    clean_name = name.strip()
    if not clean_name:
        raise DocumentNameRequiredError("Document name is required")

    document_id = uuid.uuid4()
    document = Document(
        id=document_id,
        room_id=room_id,
        name=clean_name,
        description=description,
        visibility=visibility,
        created_by=creator_id,
    )
    owner = DocumentOwner(document_id=document_id, user_id=creator_id)
    return NewDocumentPlan(document=document, owner=owner)


def is_owner(role: RoomRole, user_id: uuid.UUID, owner_user_ids: Collection[uuid.UUID]) -> bool:
    """D-12: the Master always has implicit Ownership, even with no
    explicit Owner row."""
    return role == RoomRole.MASTER or user_id in owner_user_ids


def ensure_owner(role: RoomRole, user_id: uuid.UUID, owner_user_ids: Collection[uuid.UUID]) -> None:
    if not is_owner(role, user_id, owner_user_ids):
        raise NotOwnerError("Only an Owner (or the Master) can do this")


def plan_add_owner(
    document_id: uuid.UUID, user_id: uuid.UUID, current_owner_ids: Collection[uuid.UUID]
) -> DocumentOwner:
    if user_id in current_owner_ids:
        raise AlreadyOwnerError("User is already an Owner of this Document")
    return DocumentOwner(document_id=document_id, user_id=user_id)


def ensure_can_remove_owner(user_id: uuid.UUID, current_owner_ids: Collection[uuid.UUID]) -> None:
    # No "last Owner" guard is needed here (unlike D-16 for Rooms): the
    # Master is always an implicit Owner (D-12), so a Document can never
    # end up without one even if every explicit Owner row is removed.
    if user_id not in current_owner_ids:
        raise NotAnOwnerError("User is not an explicit Owner of this Document")


def ensure_can_add_image(current_image_count: int) -> None:
    if current_image_count >= MAX_IMAGES_PER_DOCUMENT:
        raise TooManyImagesError(f"A Document can have at most {MAX_IMAGES_PER_DOCUMENT} images")


def plan_new_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    extension: str,
    uploader_id: uuid.UUID,
    current_image_count: int,
    post_id: uuid.UUID | None = None,
) -> DocumentImage:
    """D-09/FR-D1: plans one more image on a Document. The Storage object
    path is scoped under room/document so paths never collide across
    Documents, and randomized so it can't be guessed from a Document's id
    alone (the bucket is public - see architecture.md's Storage Model)."""
    ensure_can_add_image(current_image_count)
    image_id = uuid.uuid4()
    return DocumentImage(
        id=image_id,
        document_id=document_id,
        storage_path=f"{room_id}/{document_id}/{image_id.hex}{extension}",
        created_by=uploader_id,
        post_id=post_id,
    )

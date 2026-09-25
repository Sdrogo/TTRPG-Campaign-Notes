"""Rules for Documents: who may create them (D-13), Ownership (D-12), the image
limit and which image is the favorite (spec 07)."""

import uuid
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass

from app.domain.errors import DomainError
from app.domain.models import (
    Document,
    DocumentImage,
    DocumentOwner,
    DocumentVisibility,
    RoomRole,
)

MAX_IMAGES_PER_DOCUMENT = 20


class DocumentNameRequiredError(DomainError):
    """The Document name is empty once trimmed."""


class TooManyImagesError(DomainError):
    """The Document already has `MAX_IMAGES_PER_DOCUMENT` images."""


class NotOwnerError(DomainError):
    """The requester is neither an Owner nor the Master (D-12)."""


class AlreadyOwnerError(DomainError):
    """The user is already an explicit Owner."""


class NotAnOwnerError(DomainError):
    """The user isn't an explicit Owner, so there's nothing to remove."""


@dataclass(frozen=True)
class NewDocumentPlan:
    """A new Document and the Owner row for its creator, inserted together."""

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
        raise DocumentNameRequiredError("errors.document.nameRequired")

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
    """Raises `NotOwnerError` unless `is_owner` holds - the check before any
    change to a Document (Invariant 6)."""
    if not is_owner(role, user_id, owner_user_ids):
        raise NotOwnerError("errors.document.notOwner")


def plan_add_owner(
    document_id: uuid.UUID, user_id: uuid.UUID, current_owner_ids: Collection[uuid.UUID]
) -> DocumentOwner:
    """D-12/UC-08: one more explicit Owner for the Document."""
    if user_id in current_owner_ids:
        raise AlreadyOwnerError("errors.document.alreadyOwner")
    return DocumentOwner(document_id=document_id, user_id=user_id)


def ensure_can_remove_owner(user_id: uuid.UUID, current_owner_ids: Collection[uuid.UUID]) -> None:
    # No "last Owner" guard is needed here (unlike D-16 for Rooms): the
    # Master is always an implicit Owner (D-12), so a Document can never
    # end up without one even if every explicit Owner row is removed.
    """Only an explicit Owner row can be removed."""
    if user_id not in current_owner_ids:
        raise NotAnOwnerError("errors.document.notAnOwner")


def ensure_can_add_image(current_image_count: int) -> None:
    """Raises `TooManyImagesError` once the Document is at
    `MAX_IMAGES_PER_DOCUMENT`. Comment attachments count too, since they are
    Document images."""
    if current_image_count >= MAX_IMAGES_PER_DOCUMENT:
        raise TooManyImagesError("errors.document.tooManyImages", max=MAX_IMAGES_PER_DOCUMENT)


def plan_new_image(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    extension: str,
    uploader_id: uuid.UUID,
    current_images: Sequence[DocumentImage],
    post_id: uuid.UUID | None = None,
) -> DocumentImage:
    """D-09/FR-D1: plans one more image on a Document. The Storage object
    path is scoped under room/document so paths never collide across
    Documents, and randomized so it can't be guessed from a Document's id
    alone (the bucket is private - see architecture.md's Storage Model).

    `current_images` are the Document's images before this one, which also
    decide whether it becomes the favorite (spec 07)."""
    ensure_can_add_image(len(current_images))
    image_id = uuid.uuid4()
    return DocumentImage(
        id=image_id,
        document_id=document_id,
        storage_path=f"{room_id}/{document_id}/{image_id.hex}{extension}",
        created_by=uploader_id,
        post_id=post_id,
        is_favorite=not has_favorite(current_images),
    )


def has_favorite(images: Iterable[DocumentImage]) -> bool:
    """Whether one of `images` is already the favorite."""
    return any(image.is_favorite for image in images)


def next_favorite_id(remaining: Sequence[DocumentImage]) -> uuid.UUID | None:
    """Which image takes over as favorite once the previous one is gone, or
    None if nothing needs to change.

    Spec 07 says the first image uploaded is the favorite by default. Keeping
    that true after a deletion means a Document that still has images always
    has exactly one favorite - so the oldest survivor is promoted, and the
    card never falls back to an arbitrary image. `remaining` must be in the
    repository's favorite-first, then oldest-first order."""
    if not remaining or has_favorite(remaining):
        return None
    return remaining[0].id

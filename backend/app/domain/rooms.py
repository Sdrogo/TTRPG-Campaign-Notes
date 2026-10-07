"""Rules for creating a Room (UC-02, FR-R1) and changing its settings (D-13,
VR-05)."""

import uuid
from dataclasses import dataclass, replace

from app.domain.errors import DomainError
from app.domain.images import OUTPUT_EXTENSION
from app.domain.models import DocumentVisibility, Membership, Room, RoomRole, RoomStatus, Tag

# D-14 / FR-N1: default Tags created with every Room. They are also its first
# Main Tags (spec 10, 11), in this order; an Administrator can change both.
DEFAULT_TAGS: tuple[tuple[str, str], ...] = (
    ("NPC", "Type"),
    ("PC", "Type"),
    ("Place", "Type"),
    ("Event", "Type"),
    ("Artifact", "Type"),
)


class RoomNameRequiredError(DomainError):
    """The Room name is empty once trimmed."""


class OnlyMasterChangesSettingsError(DomainError):
    """Only the Master switches Players' Document creation (D-13, FR-D7)."""


class OnlyAdministratorChangesDefaultVisibilityError(DomainError):
    """Only an Administrator chooses the Room's default visibility (VR-05,
    spec 22 Decision 5)."""


class InvalidDefaultVisibilityError(DomainError):
    """Selective can't be a default: it needs a list of members."""


class OnlyAdministratorChangesImageError(DomainError):
    """Only an Administrator sets or removes the Room's image (spec 26
    Decision 2)."""


# Room images share the images bucket, under their own prefix so they can
# never collide with a Document image path ({room_id}/{document_id}/...).
ROOM_IMAGE_PATH_PREFIX = "rooms"


@dataclass(frozen=True)
class NewRoomPlan:
    """Everything a new Room is created with, inserted in one transaction: the
    Room, its creator's Membership and the default Tags."""

    room: Room
    owner_membership: Membership
    default_tags: tuple[Tag, ...]


def plan_new_room(name: str, game_system: str | None, creator_id: uuid.UUID) -> NewRoomPlan:
    """UC-02: creator becomes Administrator + Master, default Tags are created."""
    clean_name = name.strip()
    if not clean_name:
        raise RoomNameRequiredError("errors.room.nameRequired")

    room_id = uuid.uuid4()
    room = Room(
        id=room_id,
        name=clean_name,
        game_system=game_system.strip() if game_system else None,
        status=RoomStatus.ACTIVE,
        created_by=creator_id,
        players_can_create_documents=True,
    )
    owner_membership = Membership(
        id=uuid.uuid4(),
        room_id=room_id,
        user_id=creator_id,
        role=RoomRole.MASTER,
        is_admin=True,
    )
    default_tags = tuple(
        Tag(
            id=uuid.uuid4(),
            room_id=room_id,
            name=tag_name,
            category=category,
            main_position=position,
        )
        for position, (tag_name, category) in enumerate(DEFAULT_TAGS)
    )
    return NewRoomPlan(room=room, owner_membership=owner_membership, default_tags=default_tags)


def plan_room_settings(
    room: Room,
    requester: Membership,
    players_can_create_documents: bool | None,
    default_visibility: DocumentVisibility | None,
) -> Room:
    """The Room with the settings the request changes; omitted ones stay.
    Players' Document creation is the Master's (D-13, FR-D7), the default
    visibility the Administrators' (VR-05, spec 22 Decision 5): 403 for a
    setting the requester may not change, 422 for a Selective default.
    Neither is audited: no content's visibility changes."""
    if players_can_create_documents is not None and requester.role != RoomRole.MASTER:
        raise OnlyMasterChangesSettingsError("errors.room.onlyMasterCanChangeSettings")
    if default_visibility is not None:
        if not requester.is_admin:
            raise OnlyAdministratorChangesDefaultVisibilityError(
                "errors.room.onlyAdministratorCanChangeDefaultVisibility"
            )
        if default_visibility == DocumentVisibility.SELECTIVE:
            raise InvalidDefaultVisibilityError("errors.room.invalidDefaultVisibility")
    return replace(
        room,
        players_can_create_documents=(
            room.players_can_create_documents
            if players_can_create_documents is None
            else players_can_create_documents
        ),
        default_visibility=(
            room.default_visibility if default_visibility is None else default_visibility
        ),
    )


def starting_visibility(room: Room, requested: DocumentVisibility | None) -> DocumentVisibility:
    """The level new content starts at (VR-05): the one the request names, or
    the Room's default. A reply instead starts from its parent's (spec 19),
    which the Comment route decides."""
    return room.default_visibility if requested is None else requested


def ensure_can_change_image(requester: Membership) -> None:
    """Spec 26 Decision 2: the Room's image is the Administrators', like the
    rest of the setup page's Settings tab."""
    if not requester.is_admin:
        raise OnlyAdministratorChangesImageError("errors.room.onlyAdministratorChangesImage")


def plan_room_image_path(room_id: uuid.UUID) -> str:
    """A fresh random name per upload, so a replaced image never serves a
    stale cached copy under the same URL (as avatars do)."""
    return f"{ROOM_IMAGE_PATH_PREFIX}/{room_id}/{uuid.uuid4()}{OUTPUT_EXTENSION}"

import uuid
from dataclasses import dataclass

from app.domain.models import Membership, Room, RoomRole, RoomStatus, Tag

# D-14 / FR-N1: default Tags created with every Room.
DEFAULT_TAGS: tuple[tuple[str, str], ...] = (
    ("NPC", "Type"),
    ("Place", "Type"),
    ("Event", "Type"),
    ("Artifact", "Type"),
)


class RoomNameRequiredError(Exception):
    pass


@dataclass(frozen=True)
class NewRoomPlan:
    room: Room
    owner_membership: Membership
    default_tags: tuple[Tag, ...]


def plan_new_room(name: str, game_system: str | None, creator_id: uuid.UUID) -> NewRoomPlan:
    """UC-02: creator becomes Administrator + Master, default Tags are created."""
    clean_name = name.strip()
    if not clean_name:
        raise RoomNameRequiredError("Room name is required")

    room_id = uuid.uuid4()
    room = Room(
        id=room_id,
        name=clean_name,
        game_system=game_system.strip() if game_system else None,
        status=RoomStatus.ACTIVE,
        created_by=creator_id,
    )
    owner_membership = Membership(
        id=uuid.uuid4(),
        room_id=room_id,
        user_id=creator_id,
        role=RoomRole.MASTER,
        is_admin=True,
    )
    default_tags = tuple(
        Tag(id=uuid.uuid4(), room_id=room_id, name=tag_name, category=category)
        for tag_name, category in DEFAULT_TAGS
    )
    return NewRoomPlan(room=room, owner_membership=owner_membership, default_tags=default_tags)

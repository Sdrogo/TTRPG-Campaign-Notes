import uuid

import pytest

from app.domain.models import Membership, RoomRole, RoomStatus
from app.domain.rooms import (
    OnlyAdministratorChangesImageError,
    RoomNameRequiredError,
    ensure_can_change_image,
    plan_new_room,
    plan_room_image_path,
)


def test_creator_becomes_master_and_admin() -> None:
    """Creator becomes master and admin."""
    creator_id = uuid.uuid4()
    plan = plan_new_room("Curse of Strahd", "D&D 5e", creator_id)

    assert plan.room.name == "Curse of Strahd"
    assert plan.room.game_system == "D&D 5e"
    assert plan.room.status == RoomStatus.ACTIVE
    assert plan.room.created_by == creator_id
    assert plan.owner_membership.user_id == creator_id
    assert plan.owner_membership.room_id == plan.room.id
    assert plan.owner_membership.role == RoomRole.MASTER
    assert plan.owner_membership.is_admin is True


def test_default_tags_are_created_with_the_room() -> None:
    """Default tags are created with the room."""
    plan = plan_new_room("Waterdeep", None, uuid.uuid4())

    names = {tag.name for tag in plan.default_tags}
    assert names == {"NPC", "PC", "Place", "Event", "Artifact"}
    assert all(tag.room_id == plan.room.id for tag in plan.default_tags)
    assert all(tag.category == "Type" for tag in plan.default_tags)


def test_default_tags_are_the_first_main_tags_in_declaration_order() -> None:
    """Default tags are the first main tags in declaration order."""
    plan = plan_new_room("Waterdeep", None, uuid.uuid4())

    ordered = sorted(plan.default_tags, key=lambda tag: tag.main_position or 0)
    assert [tag.name for tag in ordered] == ["NPC", "PC", "Place", "Event", "Artifact"]
    assert [tag.main_position for tag in ordered] == [0, 1, 2, 3, 4]


def test_blank_name_is_rejected() -> None:
    """Blank name is rejected."""
    with pytest.raises(RoomNameRequiredError):
        plan_new_room("   ", None, uuid.uuid4())


def test_game_system_is_optional() -> None:
    """Game system is optional."""
    plan = plan_new_room("Homebrew", None, uuid.uuid4())
    assert plan.room.game_system is None


def _member(role: RoomRole, is_admin: bool) -> Membership:
    return Membership(
        id=uuid.uuid4(), room_id=uuid.uuid4(), user_id=uuid.uuid4(), role=role, is_admin=is_admin
    )


def test_only_an_administrator_changes_the_room_image() -> None:
    """Spec 26 Decision 2: the Master alone isn't enough."""
    ensure_can_change_image(_member(RoomRole.PLAYER, is_admin=True))
    for role in (RoomRole.MASTER, RoomRole.PLAYER):
        with pytest.raises(OnlyAdministratorChangesImageError):
            ensure_can_change_image(_member(role, is_admin=False))


def test_room_images_get_a_fresh_path_under_their_own_prefix() -> None:
    """Spec 26 Decision 4: never the same name twice, never a Document's path."""
    room_id = uuid.uuid4()
    first, second = plan_room_image_path(room_id), plan_room_image_path(room_id)
    assert first.startswith(f"rooms/{room_id}/") and first.endswith(".webp")
    assert first != second

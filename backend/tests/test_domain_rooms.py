import uuid

import pytest

from app.domain.models import RoomRole, RoomStatus
from app.domain.rooms import RoomNameRequiredError, plan_new_room


def test_creator_becomes_master_and_admin() -> None:
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
    plan = plan_new_room("Waterdeep", None, uuid.uuid4())

    names = {tag.name for tag in plan.default_tags}
    assert names == {"NPC", "Place", "Event", "Artifact"}
    assert all(tag.room_id == plan.room.id for tag in plan.default_tags)
    assert all(tag.category == "Type" for tag in plan.default_tags)


def test_blank_name_is_rejected() -> None:
    with pytest.raises(RoomNameRequiredError):
        plan_new_room("   ", None, uuid.uuid4())


def test_game_system_is_optional() -> None:
    plan = plan_new_room("Homebrew", None, uuid.uuid4())
    assert plan.room.game_system is None

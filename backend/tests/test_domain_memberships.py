import uuid

import pytest

from app.domain.memberships import (
    LastAdministratorError,
    LastMasterError,
    MemberNotFoundError,
    NoChangeRequestedError,
    plan_removal,
    plan_role_change,
)
from app.domain.models import Membership, RoomRole

ROOM_ID = uuid.uuid4()


def _membership(role: RoomRole, is_admin: bool) -> Membership:
    return Membership(
        id=uuid.uuid4(), room_id=ROOM_ID, user_id=uuid.uuid4(), role=role, is_admin=is_admin
    )


def test_promote_player_to_master() -> None:
    master = _membership(RoomRole.MASTER, True)
    player = _membership(RoomRole.PLAYER, False)
    actor = uuid.uuid4()

    plan = plan_role_change([master, player], player.user_id, actor, RoomRole.MASTER, None)

    assert plan.membership.role == RoomRole.MASTER
    assert plan.membership.is_admin is False
    assert plan.audit_entry.action == "role_change"
    assert plan.audit_entry.actor_user_id == actor
    assert plan.audit_entry.target_user_id == player.user_id


def test_cannot_demote_the_last_master() -> None:
    master = _membership(RoomRole.MASTER, True)
    player = _membership(RoomRole.PLAYER, False)

    with pytest.raises(LastMasterError):
        plan_role_change([master, player], master.user_id, uuid.uuid4(), RoomRole.PLAYER, None)


def test_can_demote_master_when_another_master_exists() -> None:
    master1 = _membership(RoomRole.MASTER, True)
    master2 = _membership(RoomRole.MASTER, False)

    plan = plan_role_change(
        [master1, master2], master1.user_id, uuid.uuid4(), RoomRole.PLAYER, None
    )
    assert plan.membership.role == RoomRole.PLAYER


def test_cannot_remove_admin_flag_from_the_last_administrator() -> None:
    admin = _membership(RoomRole.MASTER, True)
    other = _membership(RoomRole.PLAYER, False)

    with pytest.raises(LastAdministratorError):
        plan_role_change([admin, other], admin.user_id, uuid.uuid4(), None, False)


def test_can_add_a_second_administrator() -> None:
    admin = _membership(RoomRole.MASTER, True)
    other = _membership(RoomRole.PLAYER, False)

    plan = plan_role_change([admin, other], other.user_id, uuid.uuid4(), None, True)
    assert plan.membership.is_admin is True


def test_role_change_requires_at_least_one_field() -> None:
    admin = _membership(RoomRole.MASTER, True)
    with pytest.raises(NoChangeRequestedError):
        plan_role_change([admin], admin.user_id, uuid.uuid4(), None, None)


def test_role_change_for_unknown_member_is_rejected() -> None:
    admin = _membership(RoomRole.MASTER, True)
    with pytest.raises(MemberNotFoundError):
        plan_role_change([admin], uuid.uuid4(), uuid.uuid4(), RoomRole.PLAYER, None)


def test_removing_a_regular_player_is_allowed() -> None:
    admin = _membership(RoomRole.MASTER, True)
    player = _membership(RoomRole.PLAYER, False)

    entry = plan_removal([admin, player], player.user_id, admin.user_id, is_self=False)
    assert entry.action == "member_removed"
    assert entry.target_user_id == player.user_id


def test_member_leaving_is_logged_differently_than_removal() -> None:
    admin = _membership(RoomRole.MASTER, True)
    player = _membership(RoomRole.PLAYER, False)

    entry = plan_removal([admin, player], player.user_id, player.user_id, is_self=True)
    assert entry.action == "member_left"


def test_cannot_remove_the_last_master() -> None:
    master = _membership(RoomRole.MASTER, True)
    player = _membership(RoomRole.PLAYER, False)

    with pytest.raises(LastMasterError):
        plan_removal([master, player], master.user_id, player.user_id, is_self=False)


def test_cannot_remove_the_last_administrator() -> None:
    admin = _membership(RoomRole.PLAYER, True)
    non_admin_master = _membership(RoomRole.MASTER, False)

    with pytest.raises(LastAdministratorError):
        plan_removal(
            [admin, non_admin_master], admin.user_id, non_admin_master.user_id, is_self=False
        )


def test_last_master_can_leave_if_another_master_exists() -> None:
    # Both are Administrators too, so leaving master1 doesn't also trip the
    # separate last-Administrator guard - this test is only about the
    # last-Master rule.
    master1 = _membership(RoomRole.MASTER, True)
    master2 = _membership(RoomRole.MASTER, True)

    entry = plan_removal([master1, master2], master1.user_id, master1.user_id, is_self=True)
    assert entry.action == "member_left"

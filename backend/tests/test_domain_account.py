"""Spec 31_1: which Rooms go with a deleted account and which ones it leaves."""

import uuid

import pytest

from app.domain.account import (
    DELETION_CONFIRMATION,
    DeletionNotConfirmedError,
    SuccessorNeededError,
    ensure_confirmed,
    plan_account_erasure,
)
from app.domain.models import Membership, RoomRole

USER = uuid.uuid4()


def _membership(room_id: uuid.UUID, role: RoomRole, is_admin: bool, user: uuid.UUID) -> Membership:
    return Membership(id=uuid.uuid4(), room_id=room_id, user_id=user, role=role, is_admin=is_admin)


def test_only_the_exact_word_confirms() -> None:
    ensure_confirmed(DELETION_CONFIRMATION)
    for attempt in ("", "delete", "ELIMINA", " DELETE"):
        with pytest.raises(DeletionNotConfirmedError):
            ensure_confirmed(attempt)


def test_a_room_with_no_other_member_is_deleted() -> None:
    room = uuid.uuid4()
    plan = plan_account_erasure(
        USER, {room: [_membership(room, RoomRole.MASTER, True, USER)]}, {room: "Solo"}
    )
    assert plan.rooms_to_delete == [room]
    assert plan.departures == []


def test_a_shared_room_is_left_and_audited() -> None:
    room = uuid.uuid4()
    master = _membership(room, RoomRole.MASTER, True, uuid.uuid4())
    plan = plan_account_erasure(
        USER, {room: [master, _membership(room, RoomRole.PLAYER, False, USER)]}, {room: "Barovia"}
    )
    assert plan.rooms_to_delete == []
    [departure] = plan.departures
    assert departure.room_id == room
    assert departure.action == "member_left"
    assert departure.actor_user_id == departure.target_user_id == USER


def test_every_room_without_a_successor_is_named(  # D-16
) -> None:
    first, second, fine = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    memberships = {
        first: [
            _membership(first, RoomRole.MASTER, True, USER),
            _membership(first, RoomRole.PLAYER, False, uuid.uuid4()),
        ],
        # A Master who isn't an Administrator is no successor for the flag.
        second: [
            _membership(second, RoomRole.PLAYER, True, USER),
            _membership(second, RoomRole.MASTER, False, uuid.uuid4()),
        ],
        fine: [_membership(fine, RoomRole.MASTER, True, USER)],
    }
    with pytest.raises(SuccessorNeededError) as raised:
        plan_account_erasure(USER, memberships, {first: "zeta", second: "Alpha", fine: "Fine"})
    assert raised.value.params == {"rooms": "Alpha, zeta"}

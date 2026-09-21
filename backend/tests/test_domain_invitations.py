import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.invitations import (
    AlreadyMemberError,
    InvitationInvalidError,
    check_invitation_usable,
    plan_accepted_membership,
    plan_new_invitation,
)
from app.domain.models import Invitation, RoomRole


def _invitation(**overrides: object) -> Invitation:
    base = Invitation(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        code="abc123",
        role=RoomRole.PLAYER,
        created_by=uuid.uuid4(),
        expires_at=datetime.now(UTC) + timedelta(days=1),
        revoked_at=None,
    )
    return Invitation(**{**base.__dict__, **overrides})


def test_plan_new_invitation_has_a_code_and_expiry() -> None:
    room_id = uuid.uuid4()
    creator_id = uuid.uuid4()
    invitation = plan_new_invitation(room_id, RoomRole.PLAYER, creator_id)

    assert invitation.room_id == room_id
    assert invitation.created_by == creator_id
    assert invitation.role == RoomRole.PLAYER
    assert invitation.expires_at is not None
    assert invitation.revoked_at is None
    assert len(invitation.code) > 0


def test_usable_invitation_passes() -> None:
    check_invitation_usable(_invitation())  # should not raise


def test_revoked_invitation_is_rejected() -> None:
    with pytest.raises(InvitationInvalidError):
        check_invitation_usable(_invitation(revoked_at=datetime.now(UTC)))


def test_expired_invitation_is_rejected() -> None:
    with pytest.raises(InvitationInvalidError):
        check_invitation_usable(_invitation(expires_at=datetime.now(UTC) - timedelta(days=1)))


def test_accepting_grants_the_proposed_role_without_admin() -> None:
    invitation = _invitation(role=RoomRole.MASTER)
    user_id = uuid.uuid4()

    membership = plan_accepted_membership(invitation, user_id, already_member=False)

    assert membership.room_id == invitation.room_id
    assert membership.user_id == user_id
    assert membership.role == RoomRole.MASTER
    assert membership.is_admin is False


def test_existing_member_cannot_join_again() -> None:
    with pytest.raises(AlreadyMemberError):
        plan_accepted_membership(_invitation(), uuid.uuid4(), already_member=True)

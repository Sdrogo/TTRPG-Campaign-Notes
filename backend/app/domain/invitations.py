"""Rules for Room invitations (FR-R2, FR-R3, UC-03, UC-04), including direct
invitations to a Friend (FR-F5, spec 18_1b)."""

import secrets
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from app.domain.errors import DomainError
from app.domain.models import Invitation, Membership, RoomRole

DEFAULT_INVITE_TTL = timedelta(days=7)


class InvitationInvalidError(DomainError):
    """The invitation has expired or been revoked."""


class AlreadyMemberError(DomainError):
    """The user accepting the invitation is already a member."""


class NotAFriendError(DomainError):
    """A direct invitation goes only to a Friend of the Administrator who
    sends it (D-26)."""


class NotTheInviteeError(DomainError):
    """A direct invitation is addressed to someone else."""


def _generate_invite_code() -> str:
    """A random URL-safe code (12 characters, 72 bits), short enough to share
    by hand but not guessable."""
    return secrets.token_urlsafe(9)


def plan_new_invitation(
    room_id: uuid.UUID,
    role: RoomRole,
    created_by: uuid.UUID,
    ttl: timedelta = DEFAULT_INVITE_TTL,
) -> Invitation:
    """FR-R2: invite via link/code, with a proposed role and an expiry."""
    return Invitation(
        id=uuid.uuid4(),
        room_id=room_id,
        code=_generate_invite_code(),
        role=role,
        created_by=created_by,
        expires_at=datetime.now(UTC) + ttl,
        revoked_at=None,
    )


def plan_direct_invitation(
    room_id: uuid.UUID,
    role: RoomRole,
    created_by: uuid.UUID,
    invitee_id: uuid.UUID,
    *,
    is_friend: bool,
    invitee_is_member: bool,
    ttl: timedelta = DEFAULT_INVITE_TTL,
) -> Invitation:
    """FR-F5: an invitation addressed to one Friend of the sender, with a
    proposed role and the usual expiry. The caller has already checked the
    sender is an Administrator (UC-03). It never makes the Friend a member:
    they join only by accepting it (D-26, FR-R3)."""
    if not is_friend:
        raise NotAFriendError("errors.invitation.notAFriend")
    if invitee_is_member:
        raise AlreadyMemberError("errors.invitation.alreadyMember")
    return replace(plan_new_invitation(room_id, role, created_by, ttl=ttl), invitee_id=invitee_id)


def check_invitation_for(invitation: Invitation, user_id: uuid.UUID) -> None:
    """A link invitation works for whoever holds the code; a direct one only
    for its invitee, even if someone else learns its code."""
    if invitation.invitee_id is not None and invitation.invitee_id != user_id:
        raise NotTheInviteeError("errors.invitation.notFound")


def plan_decline(invitation: Invitation, user_id: uuid.UUID, now: datetime) -> Invitation:
    """The invitee turns a direct invitation down: it is revoked, so it
    leaves their list and its code stops working. Silent for the sender, who
    can invite again. A link invitation can't be declined (that would revoke
    it for everyone), so it is answered like one addressed to someone
    else."""
    if invitation.invitee_id is None or invitation.invitee_id != user_id:
        raise NotTheInviteeError("errors.invitation.notFound")
    check_invitation_usable(invitation, now)
    return replace(invitation, revoked_at=now)


def check_invitation_usable(invitation: Invitation, now: datetime | None = None) -> None:
    """UC-04 alternative flow: invalid/expired/revoked invitations are rejected."""
    now = now or datetime.now(UTC)
    if invitation.revoked_at is not None:
        raise InvitationInvalidError("errors.invitation.revoked")
    if invitation.expires_at is not None and invitation.expires_at < now:
        raise InvitationInvalidError("errors.invitation.expired")


def plan_accepted_membership(
    invitation: Invitation,
    user_id: uuid.UUID,
    already_member: bool,
) -> Membership:
    """UC-04: joining grants the invitation's proposed role, default Player-level admin (none)."""
    if already_member:
        raise AlreadyMemberError("errors.invitation.alreadyMember")
    return Membership(
        id=uuid.uuid4(),
        room_id=invitation.room_id,
        user_id=user_id,
        role=invitation.role,
        is_admin=False,
    )

"""Rules for Room invitations (FR-R2, FR-R3, UC-03, UC-04)."""

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from app.domain.errors import DomainError
from app.domain.models import Invitation, Membership, RoomRole

DEFAULT_INVITE_TTL = timedelta(days=7)


class InvitationInvalidError(DomainError):
    """The invitation has expired or been revoked."""


class AlreadyMemberError(DomainError):
    """The user accepting the invitation is already a member."""


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

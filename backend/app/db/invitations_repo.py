"""Room invitations."""

import uuid
from datetime import datetime

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InvitationRow, MembershipRow, RoomRow
from app.db.rooms_repo import room_from_row
from app.domain.models import Invitation, Room, RoomRole


def _invitation_from_row(row: InvitationRow) -> Invitation:
    """Maps an `invitations` row to the domain `Invitation`."""
    return Invitation(
        id=row.id,
        room_id=row.room_id,
        code=row.code,
        role=RoomRole(row.role),
        created_by=row.created_by,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        invitee_id=row.invitee_user_id,
    )


async def insert_invitation(session: AsyncSession, invitation: Invitation) -> None:
    """Stores a new invitation."""
    session.add(
        InvitationRow(
            id=invitation.id,
            room_id=invitation.room_id,
            code=invitation.code,
            role=invitation.role.value,
            created_by=invitation.created_by,
            expires_at=invitation.expires_at,
            revoked_at=invitation.revoked_at,
            invitee_user_id=invitation.invitee_id,
        )
    )
    await session.flush()


async def get_invitation_by_code(session: AsyncSession, code: str) -> Invitation | None:
    """The invitation with this code, or None, locked until the request's
    transaction ends. Accepting reads it this way, so a concurrent
    replacement of a direct invitation (`revoke_pending_direct`, an UPDATE of
    the same row) either finishes first and the accept sees it revoked, or
    waits for the accept to commit: never a join with a role that was just
    replaced. Whether it is still usable is the domain's call."""
    result = await session.execute(
        select(InvitationRow).where(InvitationRow.code == code).with_for_update()
    )
    row = result.scalar_one_or_none()
    return _invitation_from_row(row) if row else None


async def revoke_pending_direct(
    session: AsyncSession, room_id: uuid.UUID, invitee_id: uuid.UUID, now: datetime
) -> None:
    """Revokes the direct invitations to this user for this Room that are
    still open, so a new one replaces them (the latest role wins)."""
    await session.execute(
        update(InvitationRow)
        .where(
            InvitationRow.room_id == room_id,
            InvitationRow.invitee_user_id == invitee_id,
            InvitationRow.revoked_at.is_(None),
            or_(InvitationRow.expires_at.is_(None), InvitationRow.expires_at > now),
        )
        .values(revoked_at=now)
    )


async def revoke_direct_between(
    session: AsyncSession, a: uuid.UUID, b: uuid.UUID, now: datetime
) -> None:
    """Revokes the open direct invitations either user sent the other, when
    their Friendship ends (D-26): an invitation presumes the Friendship."""
    await session.execute(
        update(InvitationRow)
        .where(
            or_(
                and_(InvitationRow.created_by == a, InvitationRow.invitee_user_id == b),
                and_(InvitationRow.created_by == b, InvitationRow.invitee_user_id == a),
            ),
            InvitationRow.revoked_at.is_(None),
            or_(InvitationRow.expires_at.is_(None), InvitationRow.expires_at > now),
        )
        .values(revoked_at=now)
    )


async def list_open_direct_for(
    session: AsyncSession, user_id: uuid.UUID, now: datetime
) -> list[tuple[Invitation, Room]]:
    """The direct invitations addressed to the user that they could still
    accept: not revoked, not expired, for a Room they aren't in. Oldest
    first."""
    already_member = exists().where(
        MembershipRow.room_id == InvitationRow.room_id, MembershipRow.user_id == user_id
    )
    result = await session.execute(
        select(InvitationRow, RoomRow)
        .join(RoomRow, RoomRow.id == InvitationRow.room_id)
        .where(
            InvitationRow.invitee_user_id == user_id,
            InvitationRow.revoked_at.is_(None),
            or_(InvitationRow.expires_at.is_(None), InvitationRow.expires_at > now),
            ~already_member,
        )
        .order_by(InvitationRow.created_at, InvitationRow.id)
    )
    return [(_invitation_from_row(inv), room_from_row(room)) for inv, room in result.all()]


async def revoke_invitation(session: AsyncSession, invitation_id: uuid.UUID, now: datetime) -> None:
    """Revokes one invitation; its code stops working at once."""
    await session.execute(
        update(InvitationRow).where(InvitationRow.id == invitation_id).values(revoked_at=now)
    )

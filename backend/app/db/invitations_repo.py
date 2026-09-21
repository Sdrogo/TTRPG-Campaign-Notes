from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InvitationRow
from app.domain.models import Invitation, RoomRole


def _invitation_from_row(row: InvitationRow) -> Invitation:
    return Invitation(
        id=row.id,
        room_id=row.room_id,
        code=row.code,
        role=RoomRole(row.role),
        created_by=row.created_by,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
    )


async def insert_invitation(session: AsyncSession, invitation: Invitation) -> None:
    session.add(
        InvitationRow(
            id=invitation.id,
            room_id=invitation.room_id,
            code=invitation.code,
            role=invitation.role.value,
            created_by=invitation.created_by,
            expires_at=invitation.expires_at,
            revoked_at=invitation.revoked_at,
        )
    )
    await session.flush()


async def get_invitation_by_code(session: AsyncSession, code: str) -> Invitation | None:
    result = await session.execute(select(InvitationRow).where(InvitationRow.code == code))
    row = result.scalar_one_or_none()
    return _invitation_from_row(row) if row else None

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditLogRow, MembershipRow, RoomRow, TagRow, UserRow
from app.domain.models import AuditLogEntry, Membership, Room, RoomRole, RoomStatus
from app.domain.rooms import NewRoomPlan


def _room_from_row(row: RoomRow) -> Room:
    return Room(
        id=row.id,
        name=row.name,
        game_system=row.game_system,
        status=RoomStatus(row.status),
        created_by=row.created_by,
    )


def _membership_from_row(row: MembershipRow) -> Membership:
    return Membership(
        id=row.id,
        room_id=row.room_id,
        user_id=row.user_id,
        role=RoomRole(row.role),
        is_admin=row.is_admin,
    )


async def insert_new_room(session: AsyncSession, plan: NewRoomPlan) -> None:
    session.add(
        RoomRow(
            id=plan.room.id,
            name=plan.room.name,
            game_system=plan.room.game_system,
            status=plan.room.status.value,
            created_by=plan.room.created_by,
        )
    )
    # Flushed separately so the Room row exists before its dependents are
    # inserted. Both flushes share the caller's transaction (see
    # app/db/session.py), so the whole plan still commits atomically.
    await session.flush()

    session.add(
        MembershipRow(
            id=plan.owner_membership.id,
            room_id=plan.owner_membership.room_id,
            user_id=plan.owner_membership.user_id,
            role=plan.owner_membership.role.value,
            is_admin=plan.owner_membership.is_admin,
        )
    )
    for tag in plan.default_tags:
        session.add(
            TagRow(id=tag.id, room_id=tag.room_id, name=tag.name, category=tag.category)
        )
    await session.flush()


async def insert_membership(session: AsyncSession, membership: Membership) -> None:
    session.add(
        MembershipRow(
            id=membership.id,
            room_id=membership.room_id,
            user_id=membership.user_id,
            role=membership.role.value,
            is_admin=membership.is_admin,
        )
    )
    await session.flush()


async def get_membership(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID
) -> Membership | None:
    result = await session.execute(
        select(MembershipRow).where(
            MembershipRow.room_id == room_id, MembershipRow.user_id == user_id
        )
    )
    row = result.scalar_one_or_none()
    return _membership_from_row(row) if row else None


async def get_room(session: AsyncSession, room_id: uuid.UUID) -> Room | None:
    row = await session.get(RoomRow, room_id)
    return _room_from_row(row) if row else None


async def list_rooms_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Room, Membership]]:
    result = await session.execute(
        select(RoomRow, MembershipRow)
        .join(MembershipRow, MembershipRow.room_id == RoomRow.id)
        .where(MembershipRow.user_id == user_id)
    )
    return [(_room_from_row(room), _membership_from_row(m)) for room, m in result.all()]


async def list_memberships(session: AsyncSession, room_id: uuid.UUID) -> list[Membership]:
    result = await session.execute(
        select(MembershipRow).where(MembershipRow.room_id == room_id)
    )
    return [_membership_from_row(row) for row in result.scalars()]


async def list_members_with_email(
    session: AsyncSession, room_id: uuid.UUID
) -> list[tuple[Membership, str | None]]:
    result = await session.execute(
        select(MembershipRow, UserRow.email)
        .outerjoin(UserRow, UserRow.id == MembershipRow.user_id)
        .where(MembershipRow.room_id == room_id)
    )
    return [(_membership_from_row(m), email) for m, email in result.all()]


async def update_membership(session: AsyncSession, membership: Membership) -> None:
    row = await session.get(MembershipRow, membership.id)
    if row is None:
        raise LookupError(f"Membership {membership.id} not found")
    row.role = membership.role.value
    row.is_admin = membership.is_admin
    await session.flush()


async def delete_membership(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
    await session.execute(
        delete(MembershipRow).where(
            MembershipRow.room_id == room_id, MembershipRow.user_id == user_id
        )
    )
    await session.flush()


async def insert_audit_log(session: AsyncSession, entry: AuditLogEntry) -> None:
    session.add(
        AuditLogRow(
            id=entry.id,
            room_id=entry.room_id,
            actor_user_id=entry.actor_user_id,
            target_user_id=entry.target_user_id,
            action=entry.action,
            details=entry.details,
        )
    )
    await session.flush()

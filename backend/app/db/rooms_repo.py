"""Rooms, Memberships and the audit log."""

import uuid
from collections.abc import Collection

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db.models import AuditLogRow, MembershipRow, RoomRow, TagRow, UserRow
from app.db.users_repo import profile_from_row
from app.domain.models import AuditLogEntry, Membership, Room, RoomRole, RoomStatus, UserProfile
from app.domain.rooms import NewRoomPlan


def _room_from_row(row: RoomRow) -> Room:
    """Maps a `rooms` row to the domain `Room`."""
    return Room(
        id=row.id,
        name=row.name,
        game_system=row.game_system,
        status=RoomStatus(row.status),
        created_by=row.created_by,
        players_can_create_documents=row.players_can_create_documents,
    )


def _membership_from_row(row: MembershipRow) -> Membership:
    """Maps a `memberships` row to the domain `Membership`."""
    return Membership(
        id=row.id,
        room_id=row.room_id,
        user_id=row.user_id,
        role=RoomRole(row.role),
        is_admin=row.is_admin,
    )


async def insert_new_room(session: AsyncSession, plan: NewRoomPlan) -> None:
    """Inserts everything a `NewRoomPlan` holds - the Room, its creator's
    Membership and the default Tags - in the caller's transaction."""
    session.add(
        RoomRow(
            id=plan.room.id,
            name=plan.room.name,
            game_system=plan.room.game_system,
            status=plan.room.status.value,
            created_by=plan.room.created_by,
            players_can_create_documents=plan.room.players_can_create_documents,
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
            TagRow(
                id=tag.id,
                room_id=tag.room_id,
                name=tag.name,
                category=tag.category,
                main_position=tag.main_position,
            )
        )
    await session.flush()


async def insert_membership(session: AsyncSession, membership: Membership) -> None:
    """Adds a member to a Room."""
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
    """The user's Membership in the Room, or None if they aren't a member."""
    result = await session.execute(
        select(MembershipRow).where(
            MembershipRow.room_id == room_id, MembershipRow.user_id == user_id
        )
    )
    row = result.scalar_one_or_none()
    return _membership_from_row(row) if row else None


async def get_room(session: AsyncSession, room_id: uuid.UUID) -> Room | None:
    """The Room, or None."""
    row = await session.get(RoomRow, room_id)
    return _room_from_row(row) if row else None


async def list_rooms_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Room, Membership]]:
    """Every Room the user belongs to, with their Membership in it."""
    result = await session.execute(
        select(RoomRow, MembershipRow)
        .join(MembershipRow, MembershipRow.room_id == RoomRow.id)
        .where(MembershipRow.user_id == user_id)
    )
    return [(_room_from_row(room), _membership_from_row(m)) for room, m in result.all()]


async def list_memberships(session: AsyncSession, room_id: uuid.UUID) -> list[Membership]:
    """Every Membership in the Room."""
    result = await session.execute(select(MembershipRow).where(MembershipRow.room_id == room_id))
    return [_membership_from_row(row) for row in result.scalars()]


async def list_members_with_profile(
    session: AsyncSession, room_id: uuid.UUID
) -> list[tuple[Membership, UserProfile]]:
    """Every member of the Room with their profile. A member without a `users`
    row gets an empty profile."""
    result = await session.execute(
        select(MembershipRow, UserRow)
        .outerjoin(UserRow, UserRow.id == MembershipRow.user_id)
        .where(MembershipRow.room_id == room_id)
    )
    return [
        (_membership_from_row(m), profile_from_row(m.user_id, user)) for m, user in result.all()
    ]


async def update_membership(session: AsyncSession, membership: Membership) -> None:
    """Writes a Membership's role and Administrator flag. Raises `LookupError`
    if it no longer exists."""
    row = await session.get(MembershipRow, membership.id)
    if row is None:
        raise LookupError(f"Membership {membership.id} not found")
    row.role = membership.role.value
    row.is_admin = membership.is_admin
    await session.flush()


async def delete_membership(session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Removes the user from the Room. Their content stays (D-15)."""
    await session.execute(
        delete(MembershipRow).where(
            MembershipRow.room_id == room_id, MembershipRow.user_id == user_id
        )
    )
    await session.flush()


async def set_players_can_create_documents(
    session: AsyncSession, room_id: uuid.UUID, value: bool
) -> None:
    """Writes the Room's Document-creation setting (D-13). Raises `LookupError`
    for an unknown Room."""
    row = await session.get(RoomRow, room_id)
    if row is None:
        raise LookupError(f"Room {room_id} not found")
    row.players_can_create_documents = value
    await session.flush()


async def lock_room(session: AsyncSession, room_id: uuid.UUID) -> None:
    """Row lock held until the transaction ends: serializes writes that rely
    on the Room's Tags or members staying as read (deleting a Tag, saving the
    Main items, linking a Character's player against a member leaving)."""
    await session.execute(select(RoomRow.id).where(RoomRow.id == room_id).with_for_update())


async def delete_room(session: AsyncSession, room_id: uuid.UUID) -> None:
    """Deletes the Room row. Memberships, Invitations, Tags, combinations,
    Documents (and through them everything under a Document) and the Room's
    AuditLog rows cascade at the database level (`ondelete="CASCADE"`). Call
    only after every Document image has gone through
    `image_uploads.remove_images`: the cascade would delete the
    `document_images` rows but not their Storage objects."""
    await session.execute(delete(RoomRow).where(RoomRow.id == room_id))
    await session.flush()


async def insert_audit_log(session: AsyncSession, entry: AuditLogEntry) -> None:
    """Writes an audit entry. Call it in the same transaction as the change it
    records (Invariant 7)."""
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


async def users_sharing_a_room(
    session: AsyncSession, user_id: uuid.UUID, others: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of `others` are in at least one Room with `user_id` right now,
    in one query. Friend requests by user id need it (D-27), and so does
    the email rule for Friends (a Friend sharing no Room doesn't get it)."""
    if not others:
        return set()
    mine = aliased(MembershipRow)
    theirs = aliased(MembershipRow)
    result = await session.execute(
        select(theirs.user_id)
        .distinct()
        .join(mine, mine.room_id == theirs.room_id)
        .where(mine.user_id == user_id, theirs.user_id.in_(list(others)))
    )
    return set(result.scalars())

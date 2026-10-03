"""Rooms, Memberships and the audit log."""

import uuid
from collections.abc import Collection

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db.models import AuditLogRow, MembershipRow, RoomRow, TagRow, UserRow
from app.db.users_repo import profile_from_row
from app.domain.models import (
    AuditLogEntry,
    DocumentVisibility,
    Membership,
    Room,
    RoomRole,
    RoomStatus,
    StoredAuditLogEntry,
    UserProfile,
)
from app.domain.rooms import NewRoomPlan


def room_from_row(row: RoomRow) -> Room:
    """Maps a `rooms` row to the domain `Room`."""
    return Room(
        id=row.id,
        name=row.name,
        game_system=row.game_system,
        status=RoomStatus(row.status),
        created_by=row.created_by,
        players_can_create_documents=row.players_can_create_documents,
        default_visibility=DocumentVisibility(row.default_visibility),
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
            default_visibility=plan.room.default_visibility.value,
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
    return room_from_row(row) if row else None


async def list_rooms_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[Room, Membership]]:
    """Every Room the user belongs to, with their Membership in it."""
    result = await session.execute(
        select(RoomRow, MembershipRow)
        .join(MembershipRow, MembershipRow.room_id == RoomRow.id)
        .where(MembershipRow.user_id == user_id)
    )
    return [(room_from_row(room), _membership_from_row(m)) for room, m in result.all()]


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


async def update_room_settings(session: AsyncSession, room: Room) -> None:
    """Writes the Room's settings: Players' Document creation (D-13) and the
    default visibility (VR-05). Raises `LookupError` for an unknown Room."""
    row = await session.get(RoomRow, room.id)
    if row is None:
        raise LookupError(f"Room {room.id} not found")
    row.players_can_create_documents = room.players_can_create_documents
    row.default_visibility = room.default_visibility.value
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
    records (Invariant 7). Stamped with the clock at the write, not the
    transaction's start, so the entries one request writes (a Document's
    Reveal, then its Notes') keep their order in the history (spec 22)."""
    session.add(
        AuditLogRow(
            id=entry.id,
            room_id=entry.room_id,
            actor_user_id=entry.actor_user_id,
            target_user_id=entry.target_user_id,
            action=entry.action,
            details=entry.details,
            created_at=func.clock_timestamp(),
        )
    )
    await session.flush()


def _audit_entry_from_row(row: AuditLogRow) -> StoredAuditLogEntry:
    """Maps an `audit_log` row to the domain `StoredAuditLogEntry`."""
    return StoredAuditLogEntry(
        id=row.id,
        room_id=row.room_id,
        actor_user_id=row.actor_user_id,
        target_user_id=row.target_user_id,
        action=row.action,
        details=row.details,
        created_at=row.created_at,
    )


async def get_audit_entry(
    session: AsyncSession, room_id: uuid.UUID, entry_id: uuid.UUID
) -> StoredAuditLogEntry | None:
    """One of the Room's AuditLog rows, or None."""
    row = await session.get(AuditLogRow, entry_id)
    return _audit_entry_from_row(row) if row is not None and row.room_id == room_id else None


async def list_audit_entries(
    session: AsyncSession,
    room_id: uuid.UUID,
    actions: Collection[str],
    limit: int,
    before: AuditLogEntry | None = None,
) -> list[StoredAuditLogEntry]:
    """The Room's AuditLog rows with these actions, newest first (ties broken
    by id, so paging is stable), at most `limit`, and only those older than
    `before` when given. Unfiltered: the caller redacts them per viewer."""
    statement = select(AuditLogRow).where(
        AuditLogRow.room_id == room_id, AuditLogRow.action.in_(list(actions))
    )
    if before is not None:
        statement = statement.where(
            tuple_(AuditLogRow.created_at, AuditLogRow.id) < (before.created_at, before.id)
        )
    result = await session.execute(
        statement.order_by(AuditLogRow.created_at.desc(), AuditLogRow.id.desc()).limit(limit)
    )
    return [_audit_entry_from_row(row) for row in result.scalars()]


async def users_sharing_a_room(
    session: AsyncSession, user_id: uuid.UUID, others: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of `others` are in at least one Room with `user_id` right now,
    in one query. Friend requests by user id need it (D-27)."""
    mine = aliased(MembershipRow)
    theirs = aliased(MembershipRow)
    result = await session.execute(
        select(theirs.user_id)
        .distinct()
        .join(mine, mine.room_id == theirs.room_id)
        .where(mine.user_id == user_id, theirs.user_id.in_(list(others)))
    )
    return set(result.scalars())

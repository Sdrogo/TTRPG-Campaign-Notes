"""Friendships and Friend codes (spec 18). Reads and writes only; who may
ask, answer or remove is `app/domain/friends.py`'s call."""

import uuid

from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FriendCodeRow, FriendshipRow
from app.domain.friends import ordered_pair
from app.domain.models import FriendCode, Friendship, FriendshipStatus


def _friendship_from_row(row: FriendshipRow) -> Friendship:
    """Maps a `friendships` row to the domain `Friendship`."""
    return Friendship(
        id=row.id,
        user_low=row.user_low,
        user_high=row.user_high,
        requested_by=row.requested_by,
        status=FriendshipStatus(row.status),
        created_at=row.created_at,
        responded_at=row.responded_at,
        hidden_from_sender=row.hidden_from_sender,
    )


def _code_from_row(row: FriendCodeRow) -> FriendCode:
    """Maps a `friend_codes` row to the domain `FriendCode`."""
    return FriendCode(user_id=row.user_id, code=row.code, created_at=row.created_at)


async def lock_pair(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> None:
    """Serializes requests between the same two users until the transaction
    ends, whichever of them asks: the row may not exist yet, so there is
    nothing to `FOR UPDATE`. Without it, two crossed requests would both
    plan an insert and one would die on the unique pair constraint."""
    low, high = ordered_pair(a, b)
    key = f"friendship:{low}:{high}"
    await session.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key, 0))))


async def get_between(
    session: AsyncSession, a: uuid.UUID, b: uuid.UUID, for_update: bool = False
) -> Friendship | None:
    """The row for this pair, in either direction, or None."""
    low, high = ordered_pair(a, b)
    stmt = select(FriendshipRow).where(
        FriendshipRow.user_low == low, FriendshipRow.user_high == high
    )
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    return _friendship_from_row(row) if row else None


async def get_by_id(
    session: AsyncSession, friendship_id: uuid.UUID, for_update: bool = False
) -> Friendship | None:
    """The row with this id, or None. Whether the caller may see it is the
    domain's call."""
    stmt = select(FriendshipRow).where(FriendshipRow.id == friendship_id)
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    return _friendship_from_row(row) if row else None


async def list_for_user(session: AsyncSession, user_id: uuid.UUID) -> list[Friendship]:
    """Every row the user is part of, oldest first, unfiltered: the domain's
    `view_for` decides what they see of each."""
    result = await session.execute(
        select(FriendshipRow)
        .where(or_(FriendshipRow.user_low == user_id, FriendshipRow.user_high == user_id))
        .order_by(FriendshipRow.created_at, FriendshipRow.id)
    )
    return [_friendship_from_row(row) for row in result.scalars()]


async def insert(session: AsyncSession, friendship: Friendship) -> None:
    """Stores a new row for a pair that had none."""
    session.add(
        FriendshipRow(
            id=friendship.id,
            user_low=friendship.user_low,
            user_high=friendship.user_high,
            requested_by=friendship.requested_by,
            status=friendship.status.value,
            created_at=friendship.created_at,
            responded_at=friendship.responded_at,
            hidden_from_sender=friendship.hidden_from_sender,
        )
    )
    await session.flush()


async def save(session: AsyncSession, friendship: Friendship) -> None:
    """Writes the mutable fields of an existing row. Raises `LookupError` if
    it no longer exists."""
    row = await session.get(FriendshipRow, friendship.id)
    if row is None:
        raise LookupError(f"Friendship {friendship.id} not found")
    row.requested_by = friendship.requested_by
    row.status = friendship.status.value
    row.created_at = friendship.created_at
    row.responded_at = friendship.responded_at
    row.hidden_from_sender = friendship.hidden_from_sender
    await session.flush()


async def delete_friendship(session: AsyncSession, friendship_id: uuid.UUID) -> None:
    """Removes the row: a cancelled request or an ended Friendship."""
    await session.execute(delete(FriendshipRow).where(FriendshipRow.id == friendship_id))


async def get_code(session: AsyncSession, user_id: uuid.UUID) -> FriendCode | None:
    """The user's current Friend code, or None if they never had one."""
    row = await session.get(FriendCodeRow, user_id)
    return _code_from_row(row) if row else None


async def get_user_by_code(session: AsyncSession, code: str) -> uuid.UUID | None:
    """The owner of this Friend code, or None (unknown or regenerated)."""
    result = await session.execute(select(FriendCodeRow.user_id).where(FriendCodeRow.code == code))
    return result.scalar_one_or_none()


async def ensure_code(session: AsyncSession, candidate: FriendCode) -> FriendCode:
    """The user's code, storing `candidate` first if they have none. Two
    concurrent first visits agree on one code: the second insert does
    nothing and both read the stored one."""
    await session.execute(
        pg_insert(FriendCodeRow)
        .values(user_id=candidate.user_id, code=candidate.code, created_at=candidate.created_at)
        .on_conflict_do_nothing(index_elements=[FriendCodeRow.user_id])
    )
    stored = await get_code(session, candidate.user_id)
    if stored is None:  # pragma: no cover - only a concurrent deletion, which nothing does
        raise LookupError(f"Friend code for {candidate.user_id} not found")
    return stored


async def replace_code(session: AsyncSession, code: FriendCode) -> None:
    """Makes `code` the user's only code; the previous one stops working."""
    stmt = pg_insert(FriendCodeRow).values(
        user_id=code.user_id, code=code.code, created_at=code.created_at
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[FriendCodeRow.user_id],
        set_={"code": stmt.excluded.code, "created_at": stmt.excluded.created_at},
    )
    await session.execute(stmt)


async def are_friends(
    session: AsyncSession, a: uuid.UUID, b: uuid.UUID, for_update: bool = False
) -> bool:
    """Whether the two users have an accepted Friendship (D-26). With
    `for_update`, the row stays locked so a concurrent removal waits."""
    friendship = await get_between(session, a, b, for_update=for_update)
    return friendship is not None and friendship.status is FriendshipStatus.ACCEPTED

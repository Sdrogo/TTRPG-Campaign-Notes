"""The DDI module of Session 0 (spec 47_3): acceptances to and from the
dataclass in `app/domain/session_zero_ddi.py`. Reads return rows
unfiltered; the API keeps each to its readers."""

import uuid
from collections.abc import Collection
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SessionZeroAcceptanceRow
from app.domain.session_zero_ddi import Acceptance


def _acceptance(row: SessionZeroAcceptanceRow) -> Acceptance:
    return Acceptance(module_id=row.module_id, user_id=row.user_id, accepted_at=row.accepted_at)


async def list_acceptances(
    session: AsyncSession, module_ids: Collection[uuid.UUID]
) -> list[Acceptance]:
    """The acceptances of these modules, oldest first."""
    if not module_ids:
        return []
    result = await session.execute(
        select(SessionZeroAcceptanceRow)
        .where(SessionZeroAcceptanceRow.module_id.in_(module_ids))
        .order_by(SessionZeroAcceptanceRow.accepted_at)
    )
    return [_acceptance(row) for row in result.scalars()]


async def accept(
    session: AsyncSession,
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    user_id: uuid.UUID,
    now: datetime,
) -> None:
    """Records the Player's acceptance, or moves it to `now`."""
    await session.execute(
        insert(SessionZeroAcceptanceRow)
        .values(module_id=module_id, user_id=user_id, room_id=room_id, accepted_at=now)
        .on_conflict_do_update(
            index_elements=[SessionZeroAcceptanceRow.module_id, SessionZeroAcceptanceRow.user_id],
            set_={"accepted_at": now},
        )
    )


async def withdraw(session: AsyncSession, module_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Removes the Player's acceptance; False when there was none."""
    result = await session.execute(
        delete(SessionZeroAcceptanceRow).where(
            SessionZeroAcceptanceRow.module_id == module_id,
            SessionZeroAcceptanceRow.user_id == user_id,
        )
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def clear(session: AsyncSession, module_id: uuid.UUID) -> None:
    """Removes every acceptance of the module (its Document changed)."""
    await session.execute(
        delete(SessionZeroAcceptanceRow).where(SessionZeroAcceptanceRow.module_id == module_id)
    )


async def list_acceptances_by_user(
    session: AsyncSession, user_id: uuid.UUID
) -> list[tuple[uuid.UUID, Acceptance]]:
    """Every DDI the user accepted, in every Room, with its Room (spec 31
    export), oldest first."""
    result = await session.execute(
        select(SessionZeroAcceptanceRow)
        .where(SessionZeroAcceptanceRow.user_id == user_id)
        .order_by(SessionZeroAcceptanceRow.accepted_at)
    )
    return [(row.room_id, _acceptance(row)) for row in result.scalars()]

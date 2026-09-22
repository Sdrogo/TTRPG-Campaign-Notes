import uuid

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserRow


async def upsert_user(session: AsyncSession, user_id: uuid.UUID, email: str | None) -> None:
    stmt = pg_insert(UserRow).values(id=user_id, email=email)
    # A token may omit the email claim: keep the stored email rather than
    # overwriting it with NULL.
    stmt = stmt.on_conflict_do_update(
        index_elements=[UserRow.id],
        set_={"email": func.coalesce(stmt.excluded.email, UserRow.email)},
    )
    await session.execute(stmt)


async def get_email(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    result = await session.execute(select(UserRow.email).where(UserRow.id == user_id))
    return result.scalar_one_or_none()

"""The `users` mirror of Supabase Auth, and the profile stored on it."""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import UserRow
from app.domain.models import UserProfile


async def upsert_user(session: AsyncSession, user_id: uuid.UUID, email: str | None) -> None:
    """Makes sure the user's mirror row exists and keeps its email current,
    without touching the profile."""
    stmt = pg_insert(UserRow).values(id=user_id, email=email)
    # A token may omit the email claim: keep the stored email rather than
    # overwriting it with NULL.
    stmt = stmt.on_conflict_do_update(
        index_elements=[UserRow.id],
        set_={"email": func.coalesce(stmt.excluded.email, UserRow.email)},
    )
    await session.execute(stmt)


def profile_from_row(user_id: uuid.UUID, row: UserRow | None) -> UserProfile:
    """A missing row is an empty profile, not an error: users who never
    created or joined a Room have no mirror row yet."""
    if row is None:
        return UserProfile(user_id=user_id)
    return UserProfile(
        user_id=row.id,
        email=row.email,
        display_name=row.display_name,
        pronouns=row.pronouns,
        bio=row.bio,
        avatar_path=row.avatar_path,
        google_prefilled=row.profile_prefilled_at is not None,
    )


async def get_profile(
    session: AsyncSession, user_id: uuid.UUID, for_update: bool = False
) -> UserProfile:
    """With `for_update`, the row stays locked until the request's
    transaction ends, so two concurrent avatar changes can't both replace
    the same old avatar (and orphan one of the new ones)."""
    stmt = select(UserRow).where(UserRow.id == user_id)
    if for_update:
        stmt = stmt.with_for_update()
    row = (await session.execute(stmt)).scalar_one_or_none()
    return profile_from_row(user_id, row)


async def save_profile(session: AsyncSession, profile: UserProfile) -> None:
    """Writes the profile fields; the row must exist (see `upsert_user`)."""
    row = await session.get(UserRow, profile.user_id)
    if row is None:
        raise LookupError(f"User {profile.user_id} not found")
    row.display_name = profile.display_name
    row.pronouns = profile.pronouns
    row.bio = profile.bio
    row.avatar_path = profile.avatar_path
    await session.flush()


async def mark_prefilled(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Records that the Google defaults were offered, so it happens only
    once."""
    await session.execute(
        update(UserRow).where(UserRow.id == user_id).values(profile_prefilled_at=func.now())
    )

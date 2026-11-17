"""The backend's own sign-in records (ticket 73 step 3): provider identities
(`auth_identities`) and signed-in browsers (`auth_sessions`)."""

import uuid
from datetime import datetime

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.providers import ProviderIdentity
from app.db.models import AuthIdentityRow, AuthSessionRow
from app.domain.sign_in import SESSION_TTL

_USER_AGENT_LENGTH = 300


async def find_identity(
    session: AsyncSession, provider: str, provider_user_id: str
) -> AuthIdentityRow | None:
    """The identity already linked to this provider account, if any."""
    stmt = select(AuthIdentityRow).where(
        AuthIdentityRow.provider == provider,
        AuthIdentityRow.provider_user_id == provider_user_id,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def find_user_by_verified_email(session: AsyncSession, email: str) -> uuid.UUID | None:
    """The user whose verified email this is, so signing in with another
    provider reaches the same account (as Supabase did). Only identities the
    provider marked verified count: never the `users` mirror, which anyone
    could fill with someone else's address through an unverified sign-in.
    Supabase-era accounts are covered because the migration copied their
    identities with the provider's `email_verified`."""
    key = email.strip().lower()
    stmt = (
        select(AuthIdentityRow.user_id)
        .where(func.lower(AuthIdentityRow.email) == key, AuthIdentityRow.email_verified.is_(True))
        .order_by(AuthIdentityRow.created_at)
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def save_identity(
    session: AsyncSession,
    existing: AuthIdentityRow | None,
    provider: str,
    user_id: uuid.UUID,
    identity: ProviderIdentity,
    now: datetime,
) -> AuthIdentityRow:
    """Creates the identity, or refreshes what the provider says about it."""
    row = existing or AuthIdentityRow(
        id=uuid.uuid4(),
        provider=provider,
        provider_user_id=identity.provider_user_id,
        user_id=user_id,
        created_at=now,
    )
    row.email = identity.email
    row.email_verified = identity.email_verified
    row.name = identity.name
    row.avatar_url = identity.picture
    row.last_sign_in_at = now
    session.add(row)
    await session.flush()
    return row


async def create_session(
    session: AsyncSession,
    identity: AuthIdentityRow,
    token_hash: str,
    user_agent: str | None,
    now: datetime,
) -> None:
    """Records a signed-in browser."""
    session.add(
        AuthSessionRow(
            id=uuid.uuid4(),
            user_id=identity.user_id,
            identity_id=identity.id,
            token_hash=token_hash,
            created_at=now,
            expires_at=now + SESSION_TTL,
            user_agent=(user_agent or "")[:_USER_AGENT_LENGTH] or None,
        )
    )
    await session.flush()


async def find_session(
    session: AsyncSession, token_hash: str
) -> tuple[AuthSessionRow, AuthIdentityRow, bool] | None:
    """The session whose current or previous token this is, locked until
    the transaction ends, with its identity and whether it matched the
    current token."""
    stmt = (
        select(AuthSessionRow, AuthIdentityRow)
        .join(AuthIdentityRow, AuthIdentityRow.id == AuthSessionRow.identity_id)
        .where(
            or_(
                AuthSessionRow.token_hash == token_hash,
                AuthSessionRow.previous_token_hash == token_hash,
            )
        )
        .with_for_update(of=AuthSessionRow)
    )
    found = (await session.execute(stmt)).first()
    if found is None:
        return None
    row, identity = found
    return row, identity, row.token_hash == token_hash


def rotate(row: AuthSessionRow, new_hash: str, now: datetime) -> None:
    """Moves the session to a new refresh token and pushes its expiry back."""
    row.previous_token_hash = row.token_hash
    row.token_hash = new_hash
    row.rotated_at = now
    row.expires_at = now + SESSION_TTL


def revoke(row: AuthSessionRow, now: datetime) -> None:
    """Signs the session out for good."""
    if row.revoked_at is None:
        row.revoked_at = now


async def list_identities(session: AsyncSession, user_id: uuid.UUID) -> list[AuthIdentityRow]:
    """The user's provider identities, oldest first (personal data export)."""
    stmt = (
        select(AuthIdentityRow)
        .where(AuthIdentityRow.user_id == user_id)
        .order_by(AuthIdentityRow.created_at)
    )
    return list((await session.execute(stmt)).scalars())


async def list_sessions(session: AsyncSession, user_id: uuid.UUID) -> list[AuthSessionRow]:
    """The user's sessions, oldest first (personal data export)."""
    stmt = (
        select(AuthSessionRow)
        .where(AuthSessionRow.user_id == user_id)
        .order_by(AuthSessionRow.created_at)
    )
    return list((await session.execute(stmt)).scalars())


async def delete_user_sign_in(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Deletes the user's identities and, with them, every session (account
    deletion, spec 31_1)."""
    await session.execute(delete(AuthSessionRow).where(AuthSessionRow.user_id == user_id))
    await session.execute(delete(AuthIdentityRow).where(AuthIdentityRow.user_id == user_id))

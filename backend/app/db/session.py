"""Database sessions. A request gets one session and one transaction
(`SessionDep`): committed when the handler returns, rolled back if it raises.
Work that must wait for the commit is queued with `on_commit`."""

import logging
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)

AfterCommit = Callable[[AsyncSession], Awaitable[None]]
_AFTER_COMMIT_KEY = "after_commit"


def on_commit(session: AsyncSession, callback: AfterCommit) -> None:
    """Queues work that must happen only once the request's transaction has
    committed - e.g. deleting Storage objects, which a rollback couldn't
    bring back. Dropped if the request fails."""
    callbacks: list[AfterCommit] = session.info.setdefault(_AFTER_COMMIT_KEY, [])
    if callback not in callbacks:
        callbacks.append(callback)


def discard_after_commit(session: AsyncSession) -> None:
    """Drops the queued after-commit work, for a transaction that won't
    commit."""
    session.info.pop(_AFTER_COMMIT_KEY, None)


async def run_after_commit(session: AsyncSession) -> None:
    """Best effort: the change is already committed, so a failure here is
    logged, not raised - whatever was queued must be retryable on its own
    (see app/db/storage_cleanup.py's sweep)."""
    for callback in session.info.pop(_AFTER_COMMIT_KEY, []):
        try:
            await callback(session)
        except Exception:
            logger.exception("After-commit work failed; it will be retried by the sweep")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """The request's session, as a FastAPI dependency. Commits once the
    handler returns, rolls back if it raises, and only then runs the
    after-commit work."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            discard_after_commit(session)
            await session.rollback()
            raise
        await run_after_commit(session)


@asynccontextmanager
async def independent_session() -> AsyncIterator[AsyncSession]:
    """A session outside the request's transaction, for a write that must
    survive even if the request rolls back."""
    async with async_session_factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]

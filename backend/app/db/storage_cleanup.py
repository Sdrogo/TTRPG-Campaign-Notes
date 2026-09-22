"""Keeps Supabase Storage in step with `document_images` when a transaction
fails. Storage isn't part of the Postgres transaction, so every object that
might end up unreferenced gets a `storage_cleanup` row first:

- Upload: the row is committed in its own transaction *before* the object is
  uploaded, then deleted in the request's transaction together with the
  image row insert. If that transaction never commits, the row stays and the
  sweep removes the orphaned object.
- Delete: the image rows are deleted and cleanup rows inserted in the same
  transaction; the objects are removed only after it commits. A rollback
  restores the rows with their objects untouched; a failed removal keeps its
  cleanup row for the sweep to retry.

Removal is idempotent (`storage.remove` treats 404 as done), and an object
is never removed while an image row still references its path."""

import asyncio
import logging
from collections.abc import Collection
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session as session_module
from app.db import storage
from app.db.models import DocumentImageRow, StorageCleanupRow

logger = logging.getLogger(__name__)

# Longer than any request can take (URL fetch + Storage upload time out well
# before this), so the sweep never races an upload still in flight.
SWEEP_GRACE = timedelta(minutes=15)
SWEEP_INTERVAL_SECONDS = 600

_SCHEDULED_KEY = "storage_paths_to_remove"


async def _insert(session: AsyncSession, paths: Collection[str]) -> None:
    if paths:
        await session.execute(
            pg_insert(StorageCleanupRow)
            .values([{"storage_path": path} for path in paths])
            .on_conflict_do_nothing()
        )


async def record_pending_upload(path: str) -> None:
    """Committed on its own, before the upload: it must outlive a rollback
    of the request that's about to upload the object."""
    async with session_module.independent_session() as session:
        await _insert(session, [path])
        await session.commit()


async def confirm_upload(session: AsyncSession, path: str) -> None:
    """In the request's transaction, next to the image row insert."""
    await session.execute(delete(StorageCleanupRow).where(StorageCleanupRow.storage_path == path))


async def schedule_removal(session: AsyncSession, paths: Collection[str]) -> None:
    """In the request's transaction, next to the image row deletion; the
    objects themselves are removed after commit."""
    await _insert(session, paths)
    session.info.setdefault(_SCHEDULED_KEY, []).extend(paths)
    session_module.on_commit(session, _remove_scheduled)


async def _remove_scheduled(session: AsyncSession) -> None:
    await _remove(session, session.info.pop(_SCHEDULED_KEY, []))


async def _remove(session: AsyncSession, paths: Collection[str]) -> None:
    if not paths:
        return
    referenced = set(
        (
            await session.execute(
                select(DocumentImageRow.storage_path).where(
                    DocumentImageRow.storage_path.in_(paths)
                )
            )
        ).scalars()
    )
    done: list[str] = []
    for path in paths:
        if path not in referenced:
            try:
                await storage.remove(path)
            except storage.StorageError:
                logger.warning("Could not remove %s from Storage; will retry", path)
                continue
        done.append(path)
    if done:
        await session.execute(
            delete(StorageCleanupRow).where(StorageCleanupRow.storage_path.in_(done))
        )
    await session.commit()


async def sweep(session: AsyncSession, now: datetime | None = None) -> None:
    """Retries every cleanup row older than SWEEP_GRACE: objects left by a
    failed upload transaction, and removals that failed after commit."""
    cutoff = (now or datetime.now(UTC)) - SWEEP_GRACE
    result = await session.execute(
        select(StorageCleanupRow.storage_path).where(StorageCleanupRow.created_at < cutoff)
    )
    await _remove(session, list(result.scalars()))


async def run_sweeper() -> None:
    """Runs for the app's lifetime (started from app/main.py's lifespan)."""
    while True:
        try:
            async with session_module.async_session_factory() as session:
                await sweep(session)
        except Exception:
            logger.exception("Storage cleanup sweep failed")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)

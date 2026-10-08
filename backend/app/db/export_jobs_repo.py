"""Rows of `export_jobs` (spec 23b, 23b_1c). The Storage objects are handled by
`app/api/export_pdf_job.py` and `app/db/storage_cleanup.py`."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import import_jobs_repo, storage_cleanup
from app.db import session as session_module
from app.db.models import ExportJobRow
from app.domain.export_jobs import (
    ACTIVE_STATUSES,
    EXPORT_TTL,
    STALE_AFTER,
    ExportJob,
    ExportStatus,
    PdfOptions,
)

logger = logging.getLogger(__name__)


def _job_from_row(row: ExportJobRow) -> ExportJob:
    """Maps an `export_jobs` row to the domain `ExportJob`."""
    return ExportJob(
        id=row.id,
        room_id=row.room_id,
        requested_by=row.requested_by,
        options=PdfOptions.from_json(row.options),
        status=ExportStatus(row.status),
        storage_path=row.storage_path,
        error=row.error,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


async def insert_job(session: AsyncSession, job: ExportJob) -> bool:
    """Records a new job; False, with nothing written, when the user already
    has a queued or running one in the Room (the partial unique index decides,
    so two concurrent requests can't both get through)."""
    result = await session.execute(
        pg_insert(ExportJobRow)
        .values(
            id=job.id,
            room_id=job.room_id,
            requested_by=job.requested_by,
            options=job.options.to_json(),
            status=job.status.value,
            storage_path=None,
            error=None,
            created_at=job.created_at,
            finished_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=["room_id", "requested_by"],
            index_where=text("status IN ('queued', 'running')"),
        )
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> ExportJob | None:
    """The job, or None."""
    row = await session.get(ExportJobRow, job_id)
    return _job_from_row(row) if row is not None else None


async def list_jobs(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID
) -> list[ExportJob]:
    """The user's jobs in the Room, newest first (their own only)."""
    result = await session.execute(
        select(ExportJobRow)
        .where(ExportJobRow.room_id == room_id, ExportJobRow.requested_by == user_id)
        .order_by(ExportJobRow.created_at.desc(), ExportJobRow.id)
    )
    return [_job_from_row(row) for row in result.scalars()]


async def mark_running(session: AsyncSession, job_id: uuid.UUID) -> None:
    """The background task has picked the job up."""
    await session.execute(
        update(ExportJobRow)
        .where(ExportJobRow.id == job_id, ExportJobRow.status == ExportStatus.QUEUED.value)
        .values(status=ExportStatus.RUNNING.value)
    )


async def mark_done(
    session: AsyncSession, job_id: uuid.UUID, storage_path: str, finished_at: datetime
) -> bool:
    """The PDF is in Storage at `storage_path`. Only a running job becomes
    done: False, with nothing written, when the job is gone (its Room was
    deleted meanwhile) or was already failed (the sweep took it for lost), and
    the caller must then remove the file it uploaded."""
    result = await session.execute(
        update(ExportJobRow)
        .where(ExportJobRow.id == job_id, ExportJobRow.status == ExportStatus.RUNNING.value)
        .values(
            status=ExportStatus.DONE.value,
            storage_path=storage_path,
            error=None,
            finished_at=finished_at,
        )
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def mark_failed(
    session: AsyncSession, job_id: uuid.UUID, error: str, finished_at: datetime
) -> None:
    """The job gave up; `error` is a short internal reason, never shown raw. A
    job that already finished keeps its outcome."""
    await session.execute(
        update(ExportJobRow)
        .where(
            ExportJobRow.id == job_id,
            ExportJobRow.status.in_([status.value for status in ACTIVE_STATUSES]),
        )
        .values(status=ExportStatus.FAILED.value, error=error[:200], finished_at=finished_at)
    )


async def fail_active(
    session: AsyncSession, error: str, now: datetime, created_before: datetime | None = None
) -> int:
    """Fails queued and running jobs (all of them at startup, when nothing can
    be running any more; only those created before `created_before` in the
    sweep), so their owners aren't blocked by a job that will never finish.
    Returns how many."""
    statement = (
        update(ExportJobRow)
        .where(ExportJobRow.status.in_([status.value for status in ACTIVE_STATUSES]))
        .values(status=ExportStatus.FAILED.value, error=error, finished_at=now)
    )
    if created_before is not None:
        statement = statement.where(ExportJobRow.created_at < created_before)
    result = await session.execute(statement)
    return int(result.rowcount)  # type: ignore[attr-defined]


async def fail_stale(session: AsyncSession, now: datetime) -> int:
    """Fails the jobs that have been active for longer than `STALE_AFTER`."""
    return await fail_active(session, "stale", now, created_before=now - STALE_AFTER)


async def expire_due(session: AsyncSession, now: datetime) -> int:
    """Expires the finished PDFs older than `EXPORT_TTL`: the row drops its
    path and the object is queued for removal through `storage_cleanup`
    (removed once this transaction commits, retried by the sweep if that
    fails). Returns how many expired."""
    result = await session.execute(
        select(ExportJobRow)
        .where(
            ExportJobRow.status == ExportStatus.DONE.value,
            ExportJobRow.finished_at < now - EXPORT_TTL,
        )
        .with_for_update()
    )
    rows = list(result.scalars())
    paths = [row.storage_path for row in rows if row.storage_path]
    for row in rows:
        row.status = ExportStatus.EXPIRED.value
        row.storage_path = None
    if paths:
        await storage_cleanup.schedule_removal(session, paths)
    return len(rows)


async def list_paths_in_room(session: AsyncSession, room_id: uuid.UUID) -> list[str]:
    """The Storage paths of the Room's finished PDFs, for a Room deletion to
    queue before the rows cascade away."""
    result = await session.execute(
        select(ExportJobRow.storage_path).where(
            ExportJobRow.room_id == room_id, ExportJobRow.storage_path.is_not(None)
        )
    )
    return [path for path in result.scalars() if path is not None]


async def sweep(session: AsyncSession, now: datetime | None = None) -> None:
    """One maintenance pass: fails the jobs left active too long and expires
    the PDFs past `EXPORT_TTL`, does the same housekeeping for Document
    imports (spec 27), then commits and removes the objects."""
    moment = now or datetime.now(UTC)
    await fail_stale(session, moment)
    await expire_due(session, moment)
    await import_jobs_repo.sweep(session, moment)
    await session.commit()
    await session_module.run_after_commit(session)


async def run_export_sweeper() -> None:
    """Runs for the app's lifetime (started from app/main.py's lifespan). First
    it fails every job, Room PDF or Document import, still active: nothing can
    be running at startup, so they were cut off by a restart and would block
    their owners. Then it sweeps every `SWEEP_INTERVAL_SECONDS`."""
    try:
        async with session_module.async_session_factory() as session:
            await fail_active(session, "interrupted", datetime.now(UTC))
            await import_jobs_repo.fail_active(session, "interrupted", datetime.now(UTC))
            await session.commit()
    except Exception:
        logger.exception("Could not fail the Room PDFs interrupted by a restart")
    while True:
        try:
            async with session_module.async_session_factory() as session:
                await sweep(session)
        except Exception:
            logger.exception("Room PDF sweep failed")
        await asyncio.sleep(storage_cleanup.SWEEP_INTERVAL_SECONDS)

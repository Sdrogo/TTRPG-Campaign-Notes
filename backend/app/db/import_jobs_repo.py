"""Rows of `import_jobs` (spec 27). The Documents an import writes are
`app/db/imports_repo.py`'s; the run itself is `app/api/import_job.py`."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ImportJobRow
from app.domain.imports import (
    ACTIVE_IMPORT_STATUSES,
    IMPORT_RETENTION,
    IMPORT_STALE_AFTER,
    ImportJob,
    ImportStatus,
)

_ACTIVE = [status.value for status in ACTIVE_IMPORT_STATUSES]


def _job_from_row(row: ImportJobRow) -> ImportJob:
    """Maps an `import_jobs` row to the domain `ImportJob`."""
    return ImportJob(
        id=row.id,
        room_id=row.room_id,
        requested_by=row.requested_by,
        status=ImportStatus(row.status),
        payload=row.payload,
        result=row.result,
        error=row.error,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


async def insert_job(session: AsyncSession, job: ImportJob) -> bool:
    """Records a new job; False, with nothing written, when the user already
    has a queued or running one in the Room (the partial unique index decides,
    so two concurrent requests can't both get through)."""
    result = await session.execute(
        pg_insert(ImportJobRow)
        .values(
            id=job.id,
            room_id=job.room_id,
            requested_by=job.requested_by,
            status=job.status.value,
            payload=job.payload,
            result=None,
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


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> ImportJob | None:
    """The job, or None."""
    row = await session.get(ImportJobRow, job_id)
    return _job_from_row(row) if row is not None else None


async def mark_running(session: AsyncSession, job_id: uuid.UUID) -> None:
    """The background task has picked the job up."""
    await session.execute(
        update(ImportJobRow)
        .where(ImportJobRow.id == job_id, ImportJobRow.status == ImportStatus.QUEUED.value)
        .values(status=ImportStatus.RUNNING.value)
    )


async def mark_done(
    session: AsyncSession, job_id: uuid.UUID, result: dict[str, Any], finished_at: datetime
) -> bool:
    """The import ran: stores what it did and clears the payload. Only a
    running job becomes done; False when it is gone (its Room was deleted) or
    was already failed (the sweep took it for lost)."""
    outcome = await session.execute(
        update(ImportJobRow)
        .where(ImportJobRow.id == job_id, ImportJobRow.status == ImportStatus.RUNNING.value)
        .values(
            status=ImportStatus.DONE.value,
            payload=None,
            result=result,
            error=None,
            finished_at=finished_at,
        )
    )
    return bool(outcome.rowcount)  # type: ignore[attr-defined]


async def mark_failed(
    session: AsyncSession, job_id: uuid.UUID, error: str, finished_at: datetime
) -> None:
    """The job gave up; `error` is a short internal reason, never shown raw.
    The payload is cleared. A job that already finished keeps its outcome."""
    await session.execute(
        update(ImportJobRow)
        .where(ImportJobRow.id == job_id, ImportJobRow.status.in_(_ACTIVE))
        .values(
            status=ImportStatus.FAILED.value,
            payload=None,
            error=error[:200],
            finished_at=finished_at,
        )
    )


async def fail_active(
    session: AsyncSession, error: str, now: datetime, created_before: datetime | None = None
) -> int:
    """Fails queued and running jobs (all of them at startup, when nothing can
    be running any more; only those created before `created_before` in the
    sweep), so their owners aren't blocked by a job that will never finish.
    Returns how many."""
    statement = (
        update(ImportJobRow)
        .where(ImportJobRow.status.in_(_ACTIVE))
        .values(status=ImportStatus.FAILED.value, payload=None, error=error, finished_at=now)
    )
    if created_before is not None:
        statement = statement.where(ImportJobRow.created_at < created_before)
    return int((await session.execute(statement)).rowcount)  # type: ignore[attr-defined]


async def sweep(session: AsyncSession, now: datetime) -> None:
    """One housekeeping pass, committed by the caller: fails the jobs active
    for longer than `IMPORT_STALE_AFTER` and deletes the finished ones older
    than `IMPORT_RETENTION`."""
    await fail_active(session, "stale", now, created_before=now - IMPORT_STALE_AFTER)
    await session.execute(
        delete(ImportJobRow).where(
            ImportJobRow.status.not_in(_ACTIVE), ImportJobRow.finished_at < now - IMPORT_RETENTION
        )
    )

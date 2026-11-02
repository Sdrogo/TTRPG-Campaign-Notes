"""Rows of `import_jobs` (spec 27). The Documents an import writes are
`app/db/imports_repo.py`'s; the run itself is `app/api/import_job.py`."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, select, text, update
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
        progress=row.progress,
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
            updated_at=job.created_at,
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
        .values(status=ImportStatus.RUNNING.value, updated_at=func.now())
    )


async def start_images(session: AsyncSession, job_id: uuid.UUID, progress: dict[str, Any]) -> None:
    """The Documents are written: the job keeps the image phase's work list
    and outcome so far in `progress` and drops the parsed files, which it no
    longer needs (spec 59 Decision 4)."""
    await session.execute(
        update(ImportJobRow)
        .where(ImportJobRow.id == job_id, ImportJobRow.status == ImportStatus.RUNNING.value)
        .values(payload=None, progress=progress, updated_at=func.now())
    )


async def _locked_progress(session: AsyncSession, job_id: uuid.UUID) -> dict[str, Any] | None:
    """The job's progress, its row locked until the caller's transaction ends."""
    return await session.scalar(
        select(ImportJobRow.progress).where(ImportJobRow.id == job_id).with_for_update()
    )


async def _save_progress(
    session: AsyncSession, job_id: uuid.UUID, progress: dict[str, Any]
) -> None:
    """Stores the job's progress, now its latest sign of life."""
    await session.execute(
        update(ImportJobRow)
        .where(ImportJobRow.id == job_id)
        .values(progress=progress, updated_at=func.now())
    )


async def mark_stored(session: AsyncSession, job_id: uuid.UUID, index: int, value: str) -> None:
    """Entry `index` of the work list is stored (`value`: the new image's
    id, or "" for a map background or a Section image). Called in the
    transaction that stores it, so a resumed job never stores it twice
    (spec 59 Decision 6). Nothing for a job no longer in its image phase."""
    progress = await _locked_progress(session, job_id)
    if progress is not None:
        await _save_progress(
            session, job_id, {**progress, "stored": {**progress["stored"], str(index): value}}
        )


async def save_block(
    session: AsyncSession, job_id: uuid.UUID, done: int, skipped: dict[str, list[Any]]
) -> None:
    """A block of the work list is finished: entries before `done` need
    nothing more, and `skipped` (by result list) adds what was left out."""
    progress = await _locked_progress(session, job_id)
    if progress is not None:
        merged = {**progress, "done": done}
        for key, items in skipped.items():
            merged[key] = [*progress[key], *items]
        await _save_progress(session, job_id, merged)


async def claim_image_phases(session: AsyncSession) -> list[uuid.UUID]:
    """At startup: the jobs a restart cut off in their image phase, marked as
    progressing now so the sweep leaves them to be resumed (spec 59
    Decision 6)."""
    ids = list(
        (
            await session.scalars(
                select(ImportJobRow.id).where(
                    ImportJobRow.status == ImportStatus.RUNNING.value,
                    ImportJobRow.progress.is_not(None),
                )
            )
        ).all()
    )
    if ids:
        await session.execute(
            update(ImportJobRow).where(ImportJobRow.id.in_(ids)).values(updated_at=func.now())
        )
    return ids


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
            progress=None,
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
            progress=None,
            error=error[:200],
            finished_at=finished_at,
        )
    )


async def fail_active(
    session: AsyncSession, error: str, now: datetime, idle_before: datetime | None = None
) -> int:
    """Fails queued and running jobs, so their owners aren't blocked by a job
    that will never finish: at startup, every one that hadn't written its
    Documents yet (it wrote nothing; one in its image phase is resumed, spec
    59); in the sweep, those that saved nothing since `idle_before`.
    Returns how many."""
    statement = (
        update(ImportJobRow)
        .where(ImportJobRow.status.in_(_ACTIVE))
        .values(
            status=ImportStatus.FAILED.value,
            payload=None,
            progress=None,
            error=error,
            finished_at=now,
        )
    )
    if idle_before is None:
        statement = statement.where(ImportJobRow.progress.is_(None))
    else:
        statement = statement.where(ImportJobRow.updated_at < idle_before)
    return int((await session.execute(statement)).rowcount)  # type: ignore[attr-defined]


async def sweep(session: AsyncSession, now: datetime) -> None:
    """One housekeeping pass, committed by the caller: fails the active jobs
    that saved nothing for `IMPORT_STALE_AFTER` and deletes the finished ones
    older than `IMPORT_RETENTION`."""
    await fail_active(session, "stale", now, idle_before=now - IMPORT_STALE_AFTER)
    await session.execute(
        delete(ImportJobRow).where(
            ImportJobRow.status.not_in(_ACTIVE), ImportJobRow.finished_at < now - IMPORT_RETENTION
        )
    )

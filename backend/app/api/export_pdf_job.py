"""The background work of a Room PDF (spec 23b Decision 8, 23b_1c): starts from a
queued `export_jobs` row, snapshots what the requester (or the member the
Master generates it "as") sees, lays it out, embeds downscaled images, renders
the PDF, appends PDF Attachments when asked, stores the file in the private
`exports/` prefix and marks the job done. Any failure marks it failed; nothing
here raises to the caller."""

import asyncio
import logging
import uuid
from collections.abc import Coroutine, Iterable
from datetime import UTC, datetime
from typing import Any

from app.api.export import load_export
from app.db import export_jobs_repo, rooms_repo, storage, storage_cleanup
from app.db import session as session_module
from app.domain.errors import DomainError
from app.domain.export import Export
from app.domain.export_jobs import (
    MAX_ATTACHMENT_BYTES,
    ExportJob,
    ExportStatus,
    PdfOptions,
    export_storage_path,
)
from app.domain.files import MAX_FILE_BYTES
from app.domain.manual import Manual, ManualDocument, ManualOptions, build_manual, with_image_urls
from app.domain.view_as import ensure_can_view_as
from app.pdf.labels import manual_labels
from app.pdf.media import merge_attachments, print_image_data_uri
from app.pdf.render import render_manual_pdf

logger = logging.getLogger(__name__)

# Document images are stored at most 1920 px as WebP (spec 03), far below this.
MAX_IMAGE_DOWNLOAD_BYTES = 20 * 1024 * 1024
_IMAGE_DOWNLOADS_AT_ONCE = 6

# One render at a time per process: WeasyPrint holds the whole document in
# memory, and the hosting plans are small.
_render_slot = asyncio.Semaphore(1)
_tasks: set["asyncio.Task[None]"] = set()


class ExportRefusedError(Exception):
    """The job can't run any more as asked: the requester left the Room, the
    member to view as did, or the Room is gone."""


async def spawn(coroutine: Coroutine[Any, Any, None]) -> None:
    """Runs `coroutine` in the background, keeping a reference so it isn't
    collected while it runs. Tests replace this with one that awaits it."""
    task = asyncio.create_task(coroutine)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def run_export_job(job_id: uuid.UUID) -> None:
    """Runs the job to the end: `done` with its file in Storage, or `failed`.
    Never raises (it runs as a background task, where nobody would see it)."""
    try:
        started = await _start(job_id)
        if started is None:
            return
        job, export, room_image_path = started
        pdf = await _build_pdf(job.options, export, room_image_path)
        path = export_storage_path(job.room_id, job.id)
        # Same order as every upload: the cleanup row first, so a crash between
        # the upload and the row below leaves an object the sweep removes.
        await storage_cleanup.record_pending_upload(path)
        await storage.upload(path, pdf, "application/pdf")
        async with session_module.independent_session() as session:
            if await export_jobs_repo.mark_done(session, job.id, path, datetime.now(UTC)):
                await storage_cleanup.confirm_upload(session, path)
                await session.commit()
            else:
                # The Room was deleted while this ran, or the sweep failed the job
                # as lost: nothing references the file, so it is removed (its cleanup
                # row stays until that succeeds, for the sweep to retry).
                logger.warning("Room PDF %s finished with no job to record it on", job.id)
                await storage_cleanup.schedule_removal(session, [path])
                await session.commit()
                await session_module.run_after_commit(session)
    except ExportRefusedError:
        logger.warning("Room PDF %s refused: the requester can no longer ask for it", job_id)
        await _fail(job_id, "refused")
    except Exception:
        logger.exception("Room PDF %s failed", job_id)
        await _fail(job_id, "failed")


async def _fail(job_id: uuid.UUID, error: str) -> None:
    """Marks the job failed, in its own transaction; a failure of that is only
    logged (the sweep fails a job left active)."""
    try:
        async with session_module.independent_session() as session:
            await export_jobs_repo.mark_failed(session, job_id, error, datetime.now(UTC))
            await session.commit()
    except Exception:
        logger.exception("Could not mark Room PDF %s as failed", job_id)


async def _start(job_id: uuid.UUID) -> tuple[ExportJob, Export, str | None] | None:
    """Marks the queued job running and reads the Room's export tree for the
    member it is made for, now: the snapshot of who sees what is taken when
    the job starts (spec 23b Backend), with the Room's image path (spec 26).
    None for a job that isn't queued."""
    async with session_module.independent_session() as session:
        job = await export_jobs_repo.get_job(session, job_id)
        if job is None or job.status is not ExportStatus.QUEUED:
            return None
        await export_jobs_repo.mark_running(session, job_id)
        await session.commit()

        requester = await rooms_repo.get_membership(session, job.room_id, job.requested_by)
        room = await rooms_repo.get_room(session, job.room_id)
        if requester is None or room is None:
            raise ExportRefusedError
        viewer = requester
        if job.options.view_as_user_id is not None:
            target = await rooms_repo.get_membership(
                session, job.room_id, job.options.view_as_user_id
            )
            try:
                viewer = ensure_can_view_as(requester, target)
            except DomainError as exc:
                raise ExportRefusedError from exc
        export = await load_export(session, room, viewer, list(job.options.tag_ids))
        return job, export, room.image_path


async def _build_pdf(options: PdfOptions, export: Export, room_image_path: str | None) -> bytes:
    """The PDF bytes for `export` as `options` ask. The Room's image, when
    asked for and set, is the cover unless a Document gives one (spec 26);
    every member sees it, so it needs no visibility check."""
    room_cover_url: str | None = None
    if options.room_cover and room_image_path is not None:
        room_cover_url = (await storage.signed_urls([room_image_path])).get(room_image_path)
    manual = build_manual(
        export,
        ManualOptions(
            include_comments=options.include_comments,
            cover_document_id=options.cover_document_id,
            room_cover_url=room_cover_url,
        ),
        manual_labels(options.locale),
    )
    manual = with_image_urls(manual, await _embed_images(manual.image_urls))
    async with _render_slot:
        pdf = await asyncio.to_thread(
            render_manual_pdf, manual, options.style, options.page_size, options.locale
        )
    if options.include_attachments:
        attachments = await _download_attachments(manual, export)
        if attachments:
            pdf, _appended = await asyncio.to_thread(merge_attachments, pdf, attachments)
    return pdf


async def _embed_images(urls: Iterable[str]) -> dict[str, str]:
    """Each image link mapped to a downscaled `data:` URL. The links are the
    backend's own signed Storage links; one that can't be fetched or read is
    left out, and its page simply has no image."""
    gate = asyncio.Semaphore(_IMAGE_DOWNLOADS_AT_ONCE)

    async def one(url: str) -> tuple[str, str | None]:
        async with gate:
            try:
                data = await storage.download_signed(url, MAX_IMAGE_DOWNLOAD_BYTES)
            except storage.StorageError:
                logger.warning("A Room PDF image could not be downloaded; left out")
                return url, None
        return url, await asyncio.to_thread(print_image_data_uri, data)

    embedded = await asyncio.gather(*(one(url) for url in urls))
    return {url: uri for url, uri in embedded if uri is not None}


async def _download_attachments(manual: Manual, export: Export) -> list[bytes]:
    """The PDF Attachments of the Documents printed in the manual, in the
    manual's order, until `MAX_ATTACHMENT_BYTES`: later ones are left out. They
    are the requester's to see already (`load_export` filtered them)."""
    files = {document.id: document.files for document in export.documents}
    total = 0
    downloaded: list[bytes] = []
    for chapter in manual.chapters:
        for entry in chapter.entries:
            if not isinstance(entry, ManualDocument):
                continue
            for file in files.get(entry.id, ()):
                if total + file.size_bytes > MAX_ATTACHMENT_BYTES:
                    continue
                try:
                    data = await storage.download_signed(file.url, MAX_FILE_BYTES)
                except storage.StorageError:
                    logger.warning("A PDF Attachment could not be downloaded; left out")
                    continue
                total += len(data)
                downloaded.append(data)
    return downloaded

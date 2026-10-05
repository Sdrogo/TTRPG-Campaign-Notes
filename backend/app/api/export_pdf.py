"""The Room PDF (spec 23b, 23b_1c): a request creates a job that runs in the
background, and the requester polls it until its file is ready to download. The
content is whatever the requester sees, exactly as in the Markdown and JSON
exports (VR-07, NFR-01, Invariant 1); the Master can generate it "as" a member
to hand it out (spec 22b)."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.api.export_pdf_job import run_export_job, spawn
from app.auth.dependencies import CurrentUserDep
from app.db import export_jobs_repo, rooms_repo, storage, tags_repo
from app.db import session as session_module
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.export import pdf_filename
from app.domain.export_jobs import (
    EXPORT_TTL,
    ExportAlreadyRunningError,
    ExportJob,
    ExportStatus,
    PdfOptions,
)
from app.domain.manual import ManualStyle, PageSize
from app.domain.view_as import ensure_can_view_as
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/exports", tags=["export"])

# Most jobs `GET .../exports` lists: the newest ones of the requester.
LIST_LIMIT = 20


class PdfExportRequest(BaseModel):
    """What to put in the PDF (spec 23b Frontend). `tag_ids` keeps only the
    Documents carrying all of them. `cover_document_id` is the Document whose
    favorite image is the cover's; one the requester can't see is ignored.
    `view_as_user_id`, for the Master only, makes the PDF what that member
    sees; it is sent here and not as the `X-View-As` header, which refuses
    writes."""

    style: ManualStyle = ManualStyle.GOTHIC
    page_size: PageSize = PageSize.A4
    include_comments: bool = False
    include_attachments: bool = False
    cover_document_id: uuid.UUID | None = None
    tag_ids: list[uuid.UUID] = Field(default_factory=list)
    view_as_user_id: uuid.UUID | None = None


class ExportJobResponse(BaseModel):
    """A Room PDF job. `status` is `queued`, `running`, `done`, `failed` or
    `expired`. Once `done`, `download_url` is a short-lived signed link served
    as an attachment (never rendered from the app's origin) and `expires_at`
    says when the file is removed (24 hours after it finished); the link is
    null when it can't be signed right now, so poll again."""

    id: uuid.UUID
    status: ExportStatus
    style: ManualStyle
    page_size: PageSize
    created_at: datetime
    finished_at: datetime | None
    expires_at: datetime | None
    download_url: str | None


async def _response(
    session: AsyncSession, job: ExportJob, room_name: str | None = None
) -> ExportJobResponse:
    """The job as the API shows it, signing the download link of a finished
    one."""
    url: str | None = None
    expires_at: datetime | None = None
    if job.status is ExportStatus.DONE and job.storage_path and job.finished_at:
        expires_at = job.finished_at + EXPORT_TTL
        signed = await storage.signed_urls([job.storage_path])
        if job.storage_path in signed:
            if room_name is None:
                room = await rooms_repo.get_room(session, job.room_id)
                room_name = room.name if room is not None else "room"
            url = storage.as_download(
                signed[job.storage_path], pdf_filename(room_name, job.finished_at)
            )
    return ExportJobResponse(
        id=job.id,
        status=job.status,
        style=job.options.style,
        page_size=job.options.page_size,
        created_at=job.created_at,
        finished_at=job.finished_at,
        expires_at=expires_at,
        download_url=url,
    )


@router.post("/pdf", status_code=status.HTTP_202_ACCEPTED)
async def create_pdf_export(
    room_id: uuid.UUID,
    body: PdfExportRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ExportJobResponse:
    """Starts a Room PDF and answers 202 with the job, which is `queued` and
    runs in the background: poll `GET .../exports/{job}` until it is `done`.
    Members only (403 otherwise); 404 for a Tag of another Room; 409 when the
    requester already has a PDF queued or running in this Room; 403 when
    `view_as_user_id` is set by someone who isn't the Master or names a
    non-member. The PDF holds only what the requester (or that member) sees,
    read when the job starts. Not audited: it reads."""
    requester_id = uuid.UUID(current_user.id)
    viewer = await require_membership(session, room_id, requester_id, locale)
    if body.view_as_user_id is not None:
        target = await rooms_repo.get_membership(session, room_id, body.view_as_user_id)
        try:
            ensure_can_view_as(viewer, target)
        except DomainError as exc:
            raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    tag_ids = list(dict.fromkeys(body.tag_ids))
    if tag_ids and len(await tags_repo.get_tags_by_ids(session, room_id, tag_ids)) != len(tag_ids):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.tag.notFound", locale)

    job = ExportJob(
        id=uuid.uuid4(),
        room_id=room_id,
        requested_by=requester_id,
        options=PdfOptions(
            style=body.style,
            page_size=body.page_size,
            include_comments=body.include_comments,
            include_attachments=body.include_attachments,
            cover_document_id=body.cover_document_id,
            tag_ids=tuple(tag_ids),
            locale=locale,
            view_as_user_id=body.view_as_user_id,
        ),
        status=ExportStatus.QUEUED,
        storage_path=None,
        error=None,
        created_at=datetime.now(UTC),
        finished_at=None,
    )
    if not await export_jobs_repo.insert_job(session, job):
        raise translated_error(
            status.HTTP_409_CONFLICT,
            ExportAlreadyRunningError("errors.export.alreadyRunning"),
            locale,
        )

    async def start(_: AsyncSession) -> None:
        """After the commit, so the task finds the row."""
        await spawn(run_export_job(job.id))

    session_module.on_commit(session, start)
    return await _response(session, job)


@router.get("")
async def list_pdf_exports(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[ExportJobResponse]:
    """The requester's own Room PDFs, newest first (at most 20), for the Room
    page to show the ones not yet downloaded. Members only (403 otherwise)."""
    requester_id = uuid.UUID(current_user.id)
    await require_membership(session, room_id, requester_id, locale)
    room = await rooms_repo.get_room(session, room_id)
    room_name = room.name if room is not None else "room"
    jobs = (await export_jobs_repo.list_jobs(session, room_id, requester_id))[:LIST_LIMIT]
    return [await _response(session, job, room_name) for job in jobs]


@router.get("/{job_id}")
async def get_pdf_export(
    room_id: uuid.UUID,
    job_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ExportJobResponse:
    """The job's status and, once `done`, its download link. Members only (403
    otherwise); 404 for a job that doesn't exist, belongs to another Room or
    to someone else: a PDF is its requester's alone. Send no `X-View-As`
    header here: it would make the caller someone else."""
    requester_id = uuid.UUID(current_user.id)
    await require_membership(session, room_id, requester_id, locale)
    job = await export_jobs_repo.get_job(session, job_id)
    if job is None or job.room_id != room_id or job.requested_by != requester_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.export.notFound", locale)
    return await _response(session, job)

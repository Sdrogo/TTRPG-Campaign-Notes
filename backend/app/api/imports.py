"""Importing Documents from files (spec 27): a preview of what the files hold
and what importing them would do, then a background job that does it. Import
is the first write path that takes its content from a file, so it goes through
the same rules as creating a Document by hand (D-13, NFR-01, Invariant 1,
VR-07): who may create, visibility, limits, mention tokens, the image
pipeline. Whatever the file says about owners, grants or authors is ignored."""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile, status
from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.api.export_pdf_job import spawn
from app.api.import_job import job_payload, load_import_context, run_import_job
from app.auth.dependencies import CurrentUserDep
from app.db import import_jobs_repo, rooms_repo
from app.db import session as session_module
from app.db.session import SessionDep
from app.domain.documents import can_create_document
from app.domain.import_files import (
    MAX_FILE_BYTES,
    ImportCannotReplaceError,
    ImportFile,
    ImportFileTooLargeError,
    ImportRefusedError,
    parse_file,
)
from app.domain.imports import (
    MAX_FILES,
    ImportAlreadyRunningError,
    ImportChoices,
    ImportJob,
    ImportPlan,
    ImportStatus,
    PlannedDocument,
    plan_import,
    validate_files,
)
from app.domain.models import Membership
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/imports", tags=["import"])


class ImportWarningResponse(BaseModel):
    """Something the import leaves out or changes in a Document: `code`
    (`comments_dropped`, `files_dropped`, `player_dropped`,
    `selective_to_private`, `tags_not_created`) with the `count` or `names` it
    applies to."""

    code: str
    count: int
    names: list[str]


class PreviewDocumentResponse(BaseModel):
    """A Document found in the files. `key` names it in the import request.
    `existing_document_id` is the Document of the Room the file's id points at
    (the importer sees it); `can_replace` whether they manage it, so Replace is
    offered only then."""

    key: str
    file_name: str
    name: str
    notes_count: int
    images_count: int
    tag_names: list[str]
    existing_document_id: uuid.UUID | None
    can_replace: bool
    warnings: list[ImportWarningResponse]


class PreviewTagResponse(BaseModel):
    """A Tag the import would create."""

    name: str
    category: str | None


class ImportPreviewResponse(BaseModel):
    """What importing the files would do, nothing written or fetched:
    the Documents found, the Room's Tags they match (`matched_tags`), the ones
    that would be created (`tags_to_create`) and the ones the importer may not
    create (`unavailable_tags`), which are dropped from the Documents."""

    documents: list[PreviewDocumentResponse]
    matched_tags: list[str]
    tags_to_create: list[PreviewTagResponse]
    unavailable_tags: list[str]


class ImportChoicesRequest(BaseModel):
    """The importer's choices: `selected` are the keys of the Documents to
    import and `replace` the ones among them to replace instead of copy."""

    selected: list[str]
    replace: list[str] = []


class SkippedResponse(BaseModel):
    """Something the import skipped: an image (`kind` "image", with its link
    without the query string) and why (`reason`: `unreachable`,
    `not_an_image`, `too_large`, `limit`, `storage`, `failed`)."""

    kind: str
    document_id: uuid.UUID
    document_name: str
    url: str
    reason: str


class ImportedDocumentResponse(BaseModel):
    """A Document the import created or replaced."""

    id: uuid.UUID
    name: str


class ImportResultResponse(BaseModel):
    """What a finished import did."""

    created: list[ImportedDocumentResponse]
    replaced: list[ImportedDocumentResponse]
    skipped: list[SkippedResponse]


class ImportJobResponse(BaseModel):
    """An import job: `queued`, `running`, `done` (with `result`) or
    `failed`."""

    id: uuid.UUID
    status: ImportStatus
    created_at: datetime
    finished_at: datetime | None
    result: ImportResultResponse | None


async def _read_files(files: list[UploadFile], locale: str) -> list[ImportFile]:
    """The uploaded files parsed and within the limits (Decision 8): at most
    `MAX_FILES` files of `MAX_FILE_BYTES` (413), readable as one of the formats
    (422). Nothing is fetched or written."""
    try:
        if len(files) > MAX_FILES:
            raise ImportRefusedError("errors.import.tooManyFiles", max=MAX_FILES)
        parsed: list[ImportFile] = []
        for upload in files:
            name = (upload.filename or "file")[:200]
            data = await upload.read(MAX_FILE_BYTES + 1)
            if len(data) > MAX_FILE_BYTES:
                raise ImportFileTooLargeError(
                    "errors.import.fileTooLarge", name=name, max=MAX_FILE_BYTES // (1024 * 1024)
                )
            parsed.append(await asyncio.to_thread(parse_file, name, data))
        validate_files(parsed)
    except ImportFileTooLargeError as exc:
        raise translated_error(status.HTTP_413_CONTENT_TOO_LARGE, exc, locale) from exc
    except ImportRefusedError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    return parsed


async def _importer(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> Membership:
    """The caller's Membership, if they may create Documents here (D-13,
    FR-D7): the Master always, a Player when the Room allows it, else 403."""
    membership = await require_membership(session, room_id, user_id, locale)
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    if not can_create_document(membership.role, room.players_can_create_documents):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.document.creationDisabled", locale)
    return membership


async def _plan(
    session: AsyncSession,
    room_id: uuid.UUID,
    importer: Membership,
    files: list[ImportFile],
    choices: ImportChoices | None,
    locale: str,
) -> tuple[ImportPlan, dict[str, str]]:
    """The plan for the files against the Room as the importer sees it, and
    the name of every Tag it refers to by id (422 when nothing is selected, 403
    for a Replace the importer may not do)."""
    room = await rooms_repo.get_room(session, room_id)
    assert room is not None  # `_importer` just read it
    context = await load_import_context(session, room, importer)
    try:
        plan = plan_import(files, context, choices)
    except ImportCannotReplaceError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except ImportRefusedError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    names = {str(tag_id): name for tag_id, name in context.room_tags.values()}
    names.update({str(tag.id): tag.name for tag in plan.new_tags})
    return plan, names


def _warning(code: str, count: int, names: tuple[str, ...]) -> ImportWarningResponse:
    """A warning as the API shows it."""
    return ImportWarningResponse(code=code, count=count, names=list(names))


def _preview_document(
    document: PlannedDocument, tag_names: dict[str, str]
) -> PreviewDocumentResponse:
    """A planned Document as the preview shows it."""
    return PreviewDocumentResponse(
        key=document.key,
        file_name=document.file_name,
        name=document.name,
        notes_count=len(document.notes),
        images_count=len(document.images),
        tag_names=[tag_names[str(tag_id)] for tag_id in document.tag_ids],
        existing_document_id=document.existing_id,
        can_replace=document.can_replace,
        warnings=[_warning(w.code, w.count, w.names) for w in document.warnings],
    )


@router.post("/preview")
async def preview_import(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    files: Annotated[list[UploadFile], File()],
) -> ImportPreviewResponse:
    """What importing the uploaded files (up to 10, JSON or Markdown, each at
    most 5 MB) would do, without writing or fetching anything: the Documents
    found, which of them still exist in the Room (they can be copied or
    replaced), the Tags matched and to create, and per Document what is
    dropped or changed. For whoever may create Documents here (403
    otherwise); 413 for a file over the limit, 422 for an unreadable file or
    one over a limit."""
    importer = await _importer(session, room_id, uuid.UUID(current_user.id), locale)
    parsed = await _read_files(files, locale)
    plan, tag_names = await _plan(session, room_id, importer, parsed, None, locale)
    return ImportPreviewResponse(
        documents=[_preview_document(d, tag_names) for d in plan.documents],
        matched_tags=list(plan.matched_tags),
        tags_to_create=[
            PreviewTagResponse(name=t.name, category=t.category) for t in plan.new_tags
        ],
        unavailable_tags=list(plan.unavailable_tags),
    )


def _job_response(job: ImportJob) -> ImportJobResponse:
    """The job as the API shows it."""
    return ImportJobResponse(
        id=job.id,
        status=job.status,
        created_at=job.created_at,
        finished_at=job.finished_at,
        result=None if job.result is None else ImportResultResponse.model_validate(job.result),
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def start_import(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    files: Annotated[list[UploadFile], File()],
    choices: Annotated[str, Form()],
) -> ImportJobResponse:
    """Starts the import of the same files the preview read, with `choices`
    (a JSON object `{selected, replace}` of Document keys) and answers 202
    with the job, `queued`: poll `GET .../imports/{job}` until it is `done`.
    The files are read and planned again here, so a file or a choice that
    would be refused is refused now with nothing stored. 403 for someone who
    may not create Documents, or may not replace a chosen Document (an Owner
    or the Master only, D-12); 409 when they already have an import running in
    the Room. Copies belong to the importer, who is their Owner; owners,
    grants, Comments and the Character link in the files are ignored. The job
    writes everything in one transaction, then fetches the images."""
    requester_id = uuid.UUID(current_user.id)
    importer = await _importer(session, room_id, requester_id, locale)
    try:
        chosen = ImportChoicesRequest.model_validate_json(choices)
    except ValidationError as exc:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.import.badChoices", locale
        ) from exc
    parsed = await _read_files(files, locale)
    import_choices = ImportChoices(frozenset(chosen.selected), frozenset(chosen.replace))
    await _plan(session, room_id, importer, parsed, import_choices, locale)

    job = ImportJob(
        id=uuid.uuid4(),
        room_id=room_id,
        requested_by=requester_id,
        status=ImportStatus.QUEUED,
        payload=job_payload(parsed, import_choices),
        result=None,
        error=None,
        created_at=datetime.now(UTC),
        finished_at=None,
    )
    if not await import_jobs_repo.insert_job(session, job):
        raise translated_error(
            status.HTTP_409_CONFLICT,
            ImportAlreadyRunningError("errors.import.alreadyRunning"),
            locale,
        )

    async def start(_: AsyncSession) -> None:
        """After the commit, so the task finds the row."""
        await spawn(run_import_job(job.id))

    session_module.on_commit(session, start)
    return _job_response(job)


@router.get("/{job_id}")
async def get_import(
    room_id: uuid.UUID,
    job_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ImportJobResponse:
    """The import's status and, once `done`, the Documents it created or
    replaced and what it skipped. Members only (403 otherwise); 404 for a job
    that doesn't exist, belongs to another Room or to someone else: an import
    is its requester's alone. Send no `X-View-As` header here: it would make
    the caller someone else."""
    requester_id = uuid.UUID(current_user.id)
    await require_membership(session, room_id, requester_id, locale)
    job = await import_jobs_repo.get_job(session, job_id)
    if job is None or job.room_id != room_id or job.requested_by != requester_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.import.notFound", locale)
    return _job_response(job)

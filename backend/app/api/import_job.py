"""The background work of a Document import (spec 27 Decisions 9 and 15):
starts from a queued `import_jobs` row, checks again that the importer may do
it, plans against the Room as it is then, writes Tags, Documents and Notes in
one transaction (all or nothing), then fetches and attaches the images best
effort. Any failure marks the job failed; nothing here raises to the caller."""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_images_for_documents
from app.api.versions import record_revision
from app.db import (
    documents_repo,
    import_jobs_repo,
    imports_repo,
    mentions_repo,
    remote_images,
    rooms_repo,
    storage,
    storage_cleanup,
    tags_repo,
)
from app.db import session as session_module
from app.domain.documents import (
    MAX_IMAGES_PER_DOCUMENT,
    can_create_document,
    is_owner,
    plan_new_image,
)
from app.domain.errors import DomainError
from app.domain.images import ImageTooLargeError, InvalidImageError, normalize_image
from app.domain.import_files import ImportFile, file_from_json, file_to_json
from app.domain.imports import (
    ExistingDocument,
    ImportChoices,
    ImportContext,
    ImportJob,
    ImportPlan,
    ImportStatus,
    PlannedDocument,
    fold,
    plan_import,
)
from app.domain.mentions import plan_source_mentions
from app.domain.models import Membership, MentionSource, MentionSourceKind, Room, RoomRole
from app.domain.visibility import is_document_visible

logger = logging.getLogger(__name__)

_IMAGES_AT_ONCE = 4


class ImportRefusedByRoomError(Exception):
    """The job can't run any more as asked: the importer left the Room, the
    Room is gone, or Players may no longer create Documents."""


def job_payload(files: list[ImportFile], choices: ImportChoices) -> dict[str, Any]:
    """What a job keeps while it is active: the parsed files and the choices.
    Never the uploaded bytes (Decision 17)."""
    return {
        "files": [file_to_json(file) for file in files],
        "selected": None if choices.selected is None else sorted(choices.selected),
        "replace": sorted(choices.replace),
    }


def _from_payload(payload: dict[str, Any]) -> tuple[list[ImportFile], ImportChoices]:
    """The inverse of `job_payload`."""
    selected = payload["selected"]
    return (
        [file_from_json(data) for data in payload["files"]],
        ImportChoices(
            None if selected is None else frozenset(selected), frozenset(payload["replace"])
        ),
    )


async def load_import_context(
    session: AsyncSession, room: Room, importer: Membership
) -> ImportContext:
    """What a plan needs from the Room, as the importer sees it (Invariant 1):
    the Documents they see with whether they manage each and the images it
    has, the Room's Tags and whether they may create Tags (as `POST /tags`:
    an Administrator or the Master). Read in a fixed number of queries."""
    documents = await documents_repo.list_documents_for_room(session, room.id)
    ids = [document.id for document in documents]
    owners = await documents_repo.list_owner_ids_for_documents(session, ids)
    grants = await documents_repo.list_selective_grant_ids_for_documents(session, ids)
    visible = [
        document
        for document in documents
        if is_document_visible(
            document, importer.user_id, importer.role, owners[document.id], grants[document.id]
        )
    ]
    images = await get_visible_images_for_documents(session, [d.id for d in visible], importer)
    tags = await tags_repo.list_tags(session, room.id)
    return ImportContext(
        default_visibility=room.default_visibility,
        existing={
            document.id: ExistingDocument(
                document.id,
                is_owner(importer.role, importer.user_id, owners[document.id]),
                frozenset(str(image.id) for image in images.get(document.id, ())),
            )
            for document in visible
        },
        room_tags={fold(tag.name): (tag.id, tag.name) for tag in tags},
        can_manage_tags=importer.is_admin or importer.role is RoomRole.MASTER,
    )


async def run_import_job(job_id: uuid.UUID) -> None:
    """Runs the job to the end: `done` with what it did, or `failed`. Never
    raises (it runs as a background task, where nobody would see it)."""
    try:
        started = await _start(job_id)
        if started is None:
            return
        job, importer, plan = started
        created, replaced = await _write(job, importer, plan)
        skipped = await _attach_images(job.room_id, importer.user_id, plan)
        result = {"created": created, "replaced": replaced, "skipped": skipped}
        async with session_module.independent_session() as session:
            await import_jobs_repo.mark_done(session, job.id, result, datetime.now(UTC))
            await session.commit()
    except (ImportRefusedByRoomError, DomainError):
        logger.warning("Import %s refused: the importer can no longer do it", job_id)
        await _fail(job_id, "refused")
    except Exception:
        logger.exception("Import %s failed", job_id)
        await _fail(job_id, "failed")


async def _fail(job_id: uuid.UUID, error: str) -> None:
    """Marks the job failed, in its own transaction; a failure of that is only
    logged (the sweep fails a job left active)."""
    try:
        async with session_module.independent_session() as session:
            await import_jobs_repo.mark_failed(session, job_id, error, datetime.now(UTC))
            await session.commit()
    except Exception:
        logger.exception("Could not mark import %s as failed", job_id)


async def _start(job_id: uuid.UUID) -> tuple[ImportJob, Membership, ImportPlan] | None:
    """Marks the queued job running, checks the importer is still a member who
    may create Documents (Decision 10) and plans the import against the Room
    now. None for a job that isn't queued."""
    async with session_module.independent_session() as session:
        job = await import_jobs_repo.get_job(session, job_id)
        if job is None or job.status is not ImportStatus.QUEUED or job.payload is None:
            return None
        await import_jobs_repo.mark_running(session, job_id)
        await session.commit()

        importer = await rooms_repo.get_membership(session, job.room_id, job.requested_by)
        room = await rooms_repo.get_room(session, job.room_id)
        if importer is None or room is None:
            raise ImportRefusedByRoomError
        if not can_create_document(importer.role, room.players_can_create_documents):
            raise ImportRefusedByRoomError
        files, choices = _from_payload(job.payload)
        context = await load_import_context(session, room, importer)
        return job, importer, plan_import(files, context, choices)


async def _write(
    job: ImportJob, importer: Membership, plan: ImportPlan
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """The one transaction of the import (Decision 9): Tags, copied Documents,
    replaced information, backlinks and history. Returns the Documents created
    and replaced as `{id, name}`."""
    now = datetime.now(UTC)
    copies = [d for d in plan.documents if not d.replaces]
    replaced = [d for d in plan.documents if d.replaces]
    async with session_module.independent_session() as session:
        for document in sorted(replaced, key=lambda d: str(d.id)):
            await documents_repo.lock_document(session, document.id)
        await imports_repo.insert_tags(session, job.room_id, plan.new_tags)
        await imports_repo.insert_copies(session, job.room_id, importer.user_id, copies, now)
        await imports_repo.replace_information(session, importer.user_id, replaced, now)
        for document in plan.documents:
            await _index(session, document)
        for document in replaced:
            # One new revision, so the replace can be undone from the history.
            await record_revision(session, document.id, importer.user_id, now=now, force_new=True)
        await session.commit()
    return (
        [{"id": str(d.id), "name": d.name} for d in copies],
        [{"id": str(d.id), "name": d.name} for d in replaced],
    )


async def _index(session: AsyncSession, document: PlannedDocument) -> None:
    """Writes the backlinks a Document's description and Notes hold (spec 20).
    A replaced Document's description is always rewritten, to clear the old
    ones; its old Notes took theirs with them."""
    description = plan_source_mentions(document.text, document.id)
    if description or document.replaces:
        await mentions_repo.replace_mentions(
            session, MentionSource(document.id, MentionSourceKind.DESCRIPTION), description
        )
    for note in document.notes:
        planned = plan_source_mentions(note.text, document.id)
        if planned:
            await mentions_repo.replace_mentions(
                session,
                MentionSource(document.id, MentionSourceKind.NOTE, note_id=note.id),
                planned,
            )


def _skip(plan_document: PlannedDocument, url: str, reason: str) -> dict[str, str]:
    """A skipped image, named without its query string (a signed link's token
    is the file's own business)."""
    parts = urlsplit(url)
    return {
        "kind": "image",
        "document_id": str(plan_document.id),
        "document_name": plan_document.name,
        "url": f"{parts.scheme}://{parts.netloc}{parts.path}"[:200],
        "reason": reason,
    }


async def _attach_images(
    room_id: uuid.UUID, importer_id: uuid.UUID, plan: ImportPlan
) -> list[dict[str, str]]:
    """Fetches and attaches every planned image, a few at a time, each
    Document's in order so its favorite is stored first. One that fails is
    skipped and listed, never failing the import (Decision 15)."""
    skipped: list[dict[str, str]] = []
    gate = asyncio.Semaphore(_IMAGES_AT_ONCE)
    database = asyncio.Lock()

    async def one_document(document: PlannedDocument) -> None:
        for image in document.images:
            async with gate:
                try:
                    data = await remote_images.fetch_image_bytes(image.url)
                except remote_images.RemoteImageError:
                    skipped.append(_skip(document, image.url, "unreachable"))
                    continue
            async with database:
                reason = await _store_image(room_id, importer_id, document, data)
            if reason is not None:
                skipped.append(_skip(document, image.url, reason))

    await asyncio.gather(*(one_document(d) for d in plan.documents if d.images))
    return skipped


async def _store_image(
    room_id: uuid.UUID, importer_id: uuid.UUID, document: PlannedDocument, data: bytes
) -> str | None:
    """Attaches one fetched image to its Document in the usual order
    (`record_pending_upload`, upload, row and `confirm_upload` in one
    transaction), so a crash leaks nothing. None when it is stored, else why
    it was skipped; a Document deleted meanwhile just drops its images."""
    try:
        normalized = await asyncio.to_thread(normalize_image, data)
    except ImageTooLargeError:
        return "too_large"
    except InvalidImageError:
        return "not_an_image"
    try:
        async with session_module.independent_session() as session:
            row = await documents_repo.get_document(session, document.id)
            if row is None or row.room_id != room_id:
                return None
            await documents_repo.lock_document(session, document.id)
            current = await documents_repo.list_images(session, document.id)
            if len(current) >= MAX_IMAGES_PER_DOCUMENT:
                return "limit"
            image = plan_new_image(room_id, document.id, normalized.extension, importer_id, current)
            await storage_cleanup.record_pending_upload(image.storage_path)
            await storage.upload(image.storage_path, normalized.data, normalized.content_type)
            await documents_repo.insert_image(session, image)
            await storage_cleanup.confirm_upload(session, image.storage_path)
            await session.commit()
    except storage.StorageError:
        return "storage"
    except Exception:
        logger.exception("An imported image could not be attached")
        return "failed"
    return None

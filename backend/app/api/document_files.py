"""PDF Attachments on a Document (FR-D8, D-21, D-22, spec 16): upload and
removal by the Document's Owners and the Master. An Attachment has the
Document's visibility (VR-12), so it is only ever reached through a Document
the requester already sees; the files themselves are listed in every
single-Document response (`documents.DocumentDetailResponse.files`)."""

import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from datetime import UTC, datetime

from fastapi import APIRouter, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_owned_document
from app.api.errors import http_error, translated_error
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, files_repo, storage, storage_cleanup
from app.db.session import SessionDep
from app.domain.documents import is_owner
from app.domain.files import (
    MAX_FILE_BYTES,
    FileTooLargeError,
    FileUpload,
    NotPdfError,
    TooManyFilesError,
    clean_display_name,
    ensure_can_add_file,
    plan_new_file,
    validate_pdf,
)
from app.domain.models import DocumentFile, Membership
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/documents/{document_id}/files", tags=["files"])


class FileResponse(BaseModel):
    """An Attachment as every route serializes it: a short-lived signed link
    that downloads the file under its name, never the Storage path."""

    id: uuid.UUID
    document_id: uuid.UUID
    name: str
    size_bytes: int
    content_type: str
    uploaded_by: uuid.UUID
    created_at: datetime
    # Served with `Content-Disposition: attachment` (D-22): never rendered
    # from the app's own origin.
    url: str
    # Whether the requester may remove it - the Document's Owners and the
    # Master (D-22), decided here so the UI never re-derives it.
    can_delete: bool


async def sign_files(files: Iterable[DocumentFile]) -> dict[str, str]:
    """Signed links for files already known to be visible to the requester,
    in one Storage request. Pass the result to `file_responses`."""
    return await storage.signed_urls([file.storage_path for file in files])


def file_responses(
    files: Iterable[DocumentFile],
    urls: Mapping[str, str],
    viewer: Membership,
    owner_ids: Collection[uuid.UUID],
) -> list[FileResponse]:
    """Serializes the files of a Document `viewer` is known to see. A file
    Storage couldn't sign is left out, like an image (`storage.signed_urls`)."""
    can_delete = is_owner(viewer.role, viewer.user_id, owner_ids)
    return [
        FileResponse(
            id=file.id,
            document_id=file.document_id,
            name=file.display_name,
            size_bytes=file.size_bytes,
            content_type=file.content_type,
            uploaded_by=file.uploaded_by,
            created_at=file.created_at,
            url=storage.as_download(urls[file.storage_path], file.display_name),
            can_delete=can_delete,
        )
        for file in files
        if file.storage_path in urls
    ]


async def remove_files(session: AsyncSession, files: Sequence[DocumentFile]) -> None:
    """Deletes the rows now; the Storage objects go only once the request's
    transaction commits, and are retried by the sweep if Storage is down.
    Deleting a Document or a Room calls this before the row cascade, which
    would otherwise drop the rows without ever queuing their objects."""
    await files_repo.delete_files(session, [file.id for file in files])
    await storage_cleanup.schedule_removal(session, [file.storage_path for file in files])


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_file(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> FileResponse:
    """UC-20: an Owner (or the Master, D-12) attaches a PDF. Accepted by its
    content, not its name: 422 when the bytes aren't a PDF, 413 over 10 MB,
    409 once the Document has 10 (D-22). 404 for a Document the requester
    can't see, 403 for one they see but don't own. The file is stored as
    uploaded and named after the uploaded file."""
    requester_id = uuid.UUID(current_user.id)
    document, owner_ids, membership = await get_owned_document(
        session, room_id, document_id, requester_id, locale
    )

    # Locked before counting, for the rest of the request: two concurrent
    # uploads would otherwise both see 9 files and both insert.
    await documents_repo.lock_document(session, document.id)
    current = await files_repo.list_files(session, document.id)
    try:
        ensure_can_add_file(len(current))
    except TooManyFilesError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    # One byte past the cap, so an oversized file is caught without reading
    # all of it.
    data = await file.read(MAX_FILE_BYTES + 1)
    try:
        validate_pdf(data)
    except FileTooLargeError as exc:
        raise translated_error(status.HTTP_413_CONTENT_TOO_LARGE, exc, locale) from exc
    except NotPdfError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    planned = plan_new_file(
        document.id,
        FileUpload(data=data, display_name=clean_display_name(file.filename)),
        requester_id,
        len(current),
        datetime.now(UTC),
    )
    # Marked as a cleanup candidate before the upload, and the mark cleared in
    # the same transaction as the row insert: if that transaction never
    # commits, the sweep removes the orphaned object.
    await storage_cleanup.record_pending_upload(planned.storage_path)
    try:
        await storage.upload(planned.storage_path, data, planned.content_type)
    except storage.StorageError as exc:
        raise http_error(
            status.HTTP_502_BAD_GATEWAY, "errors.file.storageUnavailable", locale
        ) from exc
    # Signed before the row is recorded: if Storage can't sign a link right
    # now, nothing points at the object and its cleanup mark stays, so the
    # sweep removes it.
    responses = file_responses([planned], await sign_files([planned]), membership, owner_ids)
    if not responses:
        raise http_error(status.HTTP_502_BAD_GATEWAY, "errors.file.storageUnavailable", locale)
    await files_repo.insert_file(session, planned)
    await storage_cleanup.confirm_upload(session, planned.storage_path)
    return responses[0]


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    file_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """An Owner (or the Master, D-22) removes an Attachment. 404 when it isn't
    one of this Document's files; the Storage object goes after commit."""
    requester_id = uuid.UUID(current_user.id)
    await get_owned_document(session, room_id, document_id, requester_id, locale)

    files = await files_repo.list_files(session, document_id)
    target = next((file for file in files if file.id == file_id), None)
    if target is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.file.notFound", locale)
    await remove_files(session, [target])

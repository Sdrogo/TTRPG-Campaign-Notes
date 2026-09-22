"""The image pipeline shared by every route that adds or removes a Document
image - the Document's own image routes and a Comment's attachments. One
path means the size/format rules and the upload/rollback handling can't
drift apart between the two. Keeping Storage consistent with the rows when a
transaction fails is app/db/storage_cleanup.py's job."""

import asyncio
import uuid
from collections.abc import Sequence

from fastapi import HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import documents_repo, remote_images, storage, storage_cleanup
from app.db.remote_images import RemoteImageError
from app.domain.documents import TooManyImagesError, ensure_can_add_image, plan_new_image
from app.domain.images import (
    MAX_INPUT_BYTES,
    ImageTooLargeError,
    InvalidImageError,
    normalize_image,
)
from app.domain.models import Document, DocumentImage


class ImageResponse(BaseModel):
    id: uuid.UUID
    url: str


def image_response(image: DocumentImage) -> ImageResponse:
    return ImageResponse(id=image.id, url=storage.public_url(image.storage_path))


async def read_upload(file: UploadFile) -> bytes:
    # Read one byte past the limit so an oversized file is detectable
    # without buffering all of it.
    return await file.read(MAX_INPUT_BYTES + 1)


async def fetch_url(url: str) -> bytes:
    try:
        return await remote_images.fetch_image_bytes(url)
    except RemoteImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def ensure_room_for_another_image(session: AsyncSession, document: Document) -> int:
    """Returns the Document's current image count, or 409 at the limit.

    Locks the Document row first, for the rest of the request: two
    concurrent uploads would otherwise both see 19 images and both insert.
    Call it before any other image count the request relies on (e.g. a
    Comment's own limit), so that count is taken under the lock too."""
    await documents_repo.lock_document(session, document.id)
    current_count = len(await documents_repo.list_images(session, document.id))
    try:
        ensure_can_add_image(current_count)
    except TooManyImagesError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return current_count


async def store_image(
    session: AsyncSession,
    document: Document,
    uploader_id: uuid.UUID,
    data: bytes,
    current_count: int,
    post_id: uuid.UUID | None = None,
) -> DocumentImage:
    """Normalize -> upload -> record. The object is marked as a cleanup
    candidate before it's uploaded, and the mark is cleared in the same
    transaction as the row insert - so if that transaction doesn't commit,
    the sweep removes the orphan (app/db/storage_cleanup.py)."""
    try:
        normalized = await asyncio.to_thread(normalize_image, data)
    except ImageTooLargeError as exc:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(exc)) from exc
    except InvalidImageError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    try:
        image = plan_new_image(
            document.room_id,
            document.id,
            normalized.extension,
            uploader_id,
            current_count,
            post_id=post_id,
        )
    except TooManyImagesError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    await storage_cleanup.record_pending_upload(image.storage_path)
    try:
        await storage.upload(image.storage_path, normalized.data, normalized.content_type)
    except storage.StorageError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Image storage is unavailable") from exc
    await documents_repo.insert_image(session, image)
    await storage_cleanup.confirm_upload(session, image.storage_path)
    return image


async def remove_images(session: AsyncSession, images: Sequence[DocumentImage]) -> None:
    """Deletes the rows now; the Storage objects go only once the request's
    transaction commits (and are retried if Storage is down), so a later
    failure in the same request can't leave rows pointing at deleted
    objects."""
    await documents_repo.delete_images(session, [image.id for image in images])
    await storage_cleanup.schedule_removal(session, [image.storage_path for image in images])

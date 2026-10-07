"""The Room's image (spec 26): set when the Room is created or from the setup
page, and the default cover of the Room PDF. An Administrator uploads one,
imports one from a URL or removes it; every member sees it, as part of the
Room. The same image pipeline as the avatar (app/api/account.py), minus the
square crop."""

import uuid
from dataclasses import replace

from fastapi import APIRouter, UploadFile, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import http_error, translated_error
from app.api.image_uploads import fetch_url, normalize, read_upload, upload_object
from app.api.rooms import RoomResponse, signed_room_response
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo, storage_cleanup
from app.db.session import SessionDep
from app.domain.models import Room
from app.domain.rooms import (
    OnlyAdministratorChangesImageError,
    ensure_can_change_image,
    plan_room_image_path,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/image", tags=["rooms"])


class RoomImageFromUrlRequest(BaseModel):
    """A Room image to import from a URL instead of uploading a file."""

    url: HttpUrl


async def _require_administrator(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> None:
    """403 for a non-member and for a member who isn't an Administrator
    (spec 26 Decision 2), before anything is uploaded."""
    membership = await rooms_repo.get_membership(session, room_id, user_id)
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)
    try:
        ensure_can_change_image(membership)
    except OnlyAdministratorChangesImageError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc


async def _lock_room(session: AsyncSession, room_id: uuid.UUID, locale: str) -> Room:
    """The Room, locked for the rest of the request so two image changes
    can't both replace the same old image."""
    room = await rooms_repo.get_room_for_update(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    return room


async def _replace_image(session: AsyncSession, room: Room, new_path: str | None) -> RoomResponse:
    """Points the Room at `new_path` (None removes the image) and settles
    Storage in the same transaction: the new object is confirmed, the old one
    scheduled for removal after commit (app/db/storage_cleanup.py)."""
    await rooms_repo.set_room_image(session, room.id, new_path)
    if new_path is not None:
        await storage_cleanup.confirm_upload(session, new_path)
    if room.image_path is not None:
        await storage_cleanup.schedule_removal(session, [room.image_path])
    return await signed_room_response(replace(room, image_path=new_path))


async def _store_image(
    session: AsyncSession, room_id: uuid.UUID, data: bytes, locale: str
) -> RoomResponse:
    """Validates and re-encodes the image (not cropped: it is a page-sized
    cover, spec 26 Decision 3), uploads it and swaps it in. Call after
    `_require_administrator`. The file is validated before the Room is
    locked, so a bad one doesn't hold the lock."""
    normalized = await normalize(data, locale)
    room = await _lock_room(session, room_id, locale)
    path = plan_room_image_path(room_id)
    await upload_object(path, normalized, locale)
    return await _replace_image(session, room, path)


@router.post("")
async def upload_room_image(
    room_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RoomResponse:
    """Replaces the Room's image with an uploaded one (re-encoded as WebP, at
    most 1920 px on its longest side). Administrators only: 403 otherwise;
    413 for a file over the size limits, 422 for one that isn't a supported
    image."""
    await _require_administrator(session, room_id, uuid.UUID(current_user.id), locale)
    data = await read_upload(file)
    return await _store_image(session, room_id, data, locale)


@router.post("/from-url")
async def import_room_image(
    room_id: uuid.UUID,
    body: RoomImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RoomResponse:
    """Replaces the Room's image with one fetched from a URL. Administrators
    only (403 otherwise); 422 for a URL that can't be fetched safely."""
    await _require_administrator(session, room_id, uuid.UUID(current_user.id), locale)
    data = await fetch_url(str(body.url), locale)
    return await _store_image(session, room_id, data, locale)


@router.delete("")
async def remove_room_image(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> RoomResponse:
    """Removes the Room's image; the PDF then has no default cover image.
    Administrators only (403 otherwise)."""
    await _require_administrator(session, room_id, uuid.UUID(current_user.id), locale)
    room = await _lock_room(session, room_id, locale)
    return await _replace_image(session, room, None)

"""Duplicating a Room (spec 33): the Master makes a copy of the Room's setup
and content, in one request and one transaction."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, status

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.api.rooms import MyRoomResponse, room_to_response, sign_room_images
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, room_copy_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.room_copy import (
    OnlyMasterCanDuplicateError,
    ensure_can_duplicate,
    plan_room_copy,
)
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post("/{room_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_room(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> MyRoomResponse:
    """Spec 33: copies the Room as "<name> (Copy)" with its setup, Tags,
    Documents with their Notes and images, and maps (spec 40, re-pointed at
    the copied Documents), and makes the caller its only
    member, as Master and Administrator. 403 for a non-member and for any
    member but the Master. Comments, PDF Attachments, Reveals, Owners, the
    Character player and the other members are not copied; Selective content
    becomes Private and mentions of members become plain text. The copy's
    images and map backgrounds share the original's Storage objects, so no
    Storage call is made."""
    requester = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_can_duplicate(requester)
    except OnlyMasterCanDuplicateError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    # Locked first so a concurrent edit can't change what the copy reads, as
    # when the Room is deleted (`purge_room`).
    await rooms_repo.lock_room(session, room_id)
    await documents_repo.lock_documents_for_room(session, room_id)
    source = await room_copy_repo.load_source(session, room_id)
    if source is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    plan = plan_room_copy(source, requester, translate("room.copySuffix", locale))
    await room_copy_repo.insert_copy(session, plan, datetime.now(UTC))
    image_urls = await sign_room_images([plan.room])
    return MyRoomResponse(
        room=room_to_response(plan.room, image_urls),
        role=plan.membership.role,
        is_admin=plan.membership.is_admin,
    )

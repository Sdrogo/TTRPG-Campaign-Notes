"""Rooms and their members (FR-R1, FR-R4 to FR-R7): creating a Room, listing
your own, the Master's Room settings, and the Administrator's member
management."""

import uuid
from collections.abc import Iterable, Mapping

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.document_files import remove_files
from app.api.errors import http_error, translated_error
from app.api.image_uploads import remove_images
from app.api.profiles import ProfileFields, profile_fields, sign_avatars
from app.auth.dependencies import CurrentUserDep
from app.db import (
    documents_repo,
    export_jobs_repo,
    files_repo,
    reads_repo,
    reveals_repo,
    rooms_repo,
    storage,
    storage_cleanup,
    users_repo,
)
from app.db.session import SessionDep
from app.domain.memberships import (
    LastAdministratorError,
    LastMasterError,
    MemberNotFoundError,
    NoChangeRequestedError,
    plan_removal,
    plan_role_change,
)
from app.domain.models import (
    DocumentVisibility,
    Membership,
    Room,
    RoomRole,
    RoomStatus,
    UserProfile,
)
from app.domain.rooms import (
    InvalidDefaultVisibilityError,
    OnlyAdministratorChangesDefaultVisibilityError,
    OnlyMasterChangesSettingsError,
    RoomNameRequiredError,
    plan_new_room,
    plan_room_settings,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms", tags=["rooms"])


class CreateRoomRequest(BaseModel):
    """A new Room's name and optional game system."""

    name: str
    game_system: str | None = None


class RoomResponse(BaseModel):
    """A Room as every route serializes it."""

    id: uuid.UUID
    name: str
    game_system: str | None
    status: RoomStatus
    players_can_create_documents: bool
    # The level new Documents, Notes and top-level Comments start at (VR-05).
    default_visibility: DocumentVisibility
    # The Room's image (spec 26) as a short-lived signed link, never the
    # Storage path; null without one or when Storage can't sign it right now.
    image_url: str | None


class MyRoomResponse(BaseModel):
    """One of the caller's Rooms, with their role in it (FR-R6)."""

    room: RoomResponse
    role: RoomRole
    is_admin: bool


class MemberResponse(ProfileFields):
    """A member of a Room: their role and Administrator flag, plus their public
    profile."""

    user_id: uuid.UUID
    role: RoomRole
    is_admin: bool


class UpdateMemberRequest(BaseModel):
    """A role change, an Administrator flag change, or both. Omitted fields are
    left as they are."""

    role: RoomRole | None = None
    is_admin: bool | None = None


class UpdateRoomSettingsRequest(BaseModel):
    """The Room's settings; omitted ones stay. Players' Document creation is
    the Master's (D-13, FR-D7), the default visibility the Administrators'
    (VR-05, spec 22)."""

    players_can_create_documents: bool | None = None
    default_visibility: DocumentVisibility | None = None


def member_response(
    membership: Membership,
    profile: UserProfile,
    avatar_urls: Mapping[str, str],
    viewer_id: uuid.UUID,
) -> MemberResponse:
    """Serializes a member as `viewer_id` sees them. `avatar_urls` comes from
    `sign_avatars`, signed once for the whole list."""
    return MemberResponse(
        user_id=membership.user_id,
        role=membership.role,
        is_admin=membership.is_admin,
        **profile_fields(profile, avatar_urls, viewer_id).model_dump(),
    )


async def sign_room_images(rooms: Iterable[Room]) -> dict[str, str]:
    """Signed URLs for the images of `rooms`, in one Storage request. Pass the
    result to `room_to_response`."""
    return await storage.signed_urls([room.image_path for room in rooms if room.image_path])


def room_to_response(room: Room, image_urls: Mapping[str, str]) -> RoomResponse:
    """Serializes a Room the same way for every route that returns one,
    invitations included. `image_urls` comes from `sign_room_images`."""
    return RoomResponse(
        id=room.id,
        name=room.name,
        game_system=room.game_system,
        status=room.status,
        players_can_create_documents=room.players_can_create_documents,
        default_visibility=room.default_visibility,
        image_url=image_urls.get(room.image_path) if room.image_path else None,
    )


async def signed_room_response(room: Room) -> RoomResponse:
    """`room_to_response` for a single Room, signing its image."""
    return room_to_response(room, await sign_room_images([room]))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_room(
    body: CreateRoomRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RoomResponse:
    """UC-02: creates a Room; the creator becomes its Master and Administrator,
    and the default Tags are added (D-14)."""
    try:
        plan = plan_new_room(body.name, body.game_system, uuid.UUID(current_user.id))
    except RoomNameRequiredError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await rooms_repo.insert_new_room(session, plan)
    await users_repo.upsert_user(session, plan.room.created_by, current_user.email)

    return room_to_response(plan.room, {})


@router.get("")
async def list_my_rooms(current_user: CurrentUserDep, session: SessionDep) -> list[MyRoomResponse]:
    """FR-R6: the Rooms the caller belongs to, with their role in each."""
    rows = await rooms_repo.list_rooms_for_user(session, uuid.UUID(current_user.id))
    image_urls = await sign_room_images(room for room, _ in rows)
    return [
        MyRoomResponse(
            room=room_to_response(room, image_urls),
            role=membership.role,
            is_admin=membership.is_admin,
        )
        for room, membership in rows
    ]


@router.get("/{room_id}")
async def get_room(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> RoomResponse:
    """One Room, for its members only (403 otherwise)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)

    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    return await signed_room_response(room)


@router.patch("/{room_id}")
async def update_room_settings(
    room_id: uuid.UUID,
    body: UpdateRoomSettingsRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RoomResponse:
    """Changes the Room's settings: the Master switches Players' Document
    creation on or off (D-13, FR-D7), an Administrator picks the level new
    content starts at (VR-05, spec 22: Room, Master or Private; 422 for
    Selective). 403 for a non-member or a setting the requester may not
    change. Existing content keeps its visibility."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)

    try:
        updated = plan_room_settings(
            room, membership, body.players_can_create_documents, body.default_visibility
        )
    except (OnlyMasterChangesSettingsError, OnlyAdministratorChangesDefaultVisibilityError) as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except InvalidDefaultVisibilityError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc

    await rooms_repo.update_room_settings(session, updated)
    return await signed_room_response(updated)


@router.get("/{room_id}/members")
async def list_members(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[MemberResponse]:
    """Everyone in the Room with their role and profile, for any member."""
    requester_id = uuid.UUID(current_user.id)
    requester = await rooms_repo.get_membership(session, room_id, requester_id)
    if requester is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)

    rows = await rooms_repo.list_members_with_profile(session, room_id)
    avatar_urls = await sign_avatars(profile for _, profile in rows)
    return [
        member_response(membership, profile, avatar_urls, requester_id)
        for membership, profile in rows
    ]


@router.patch("/{room_id}/members/{user_id}")
async def update_member(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    body: UpdateMemberRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MemberResponse:
    """UC-05: an Administrator changes a member's role and/or Administrator
    flag - designating a new Master included (FR-R5). 409 when the change would
    leave the Room without a Master or an Administrator (D-16). Audited in the
    same transaction (Invariant 7)."""
    requester_id = uuid.UUID(current_user.id)
    requester = await rooms_repo.get_membership(session, room_id, requester_id)
    if requester is None or not requester.is_admin:
        raise http_error(
            status.HTTP_403_FORBIDDEN, "errors.room.onlyAdministratorCanChangeRoles", locale
        )

    memberships = await rooms_repo.list_memberships(session, room_id)
    try:
        plan = plan_role_change(memberships, user_id, requester_id, body.role, body.is_admin)
    except MemberNotFoundError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc
    except NoChangeRequestedError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    except (LastMasterError, LastAdministratorError) as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    await rooms_repo.update_membership(session, plan.membership)
    await rooms_repo.insert_audit_log(session, plan.audit_entry)

    profile = await users_repo.get_profile(session, user_id)
    return member_response(plan.membership, profile, await sign_avatars([profile]), requester_id)


@router.delete("/{room_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """UC-05/UC-19: an Administrator removes a member, or a member removes
    themselves (leaves). The last Master or Administrator can't go without a
    successor (D-16, 409). Audited in the same transaction (Invariant 7).
    The Characters they played stay in the Room, unlinked (D-23); their
    Document reads (spec 19b) and unopened Reveals (spec 22) are dropped."""
    requester_id = uuid.UUID(current_user.id)
    is_self = requester_id == user_id

    if not is_self:
        requester = await rooms_repo.get_membership(session, room_id, requester_id)
        if requester is None or not requester.is_admin:
            raise http_error(
                status.HTTP_403_FORBIDDEN, "errors.room.onlyAdministratorCanRemoveMembers", locale
            )

    # Taken before the membership read, so a concurrent `set_player` can't
    # link a Character to this member after their links are cleared below.
    await rooms_repo.lock_room(session, room_id)
    memberships = await rooms_repo.list_memberships(session, room_id)
    try:
        audit_entry = plan_removal(memberships, user_id, requester_id, is_self=is_self)
    except MemberNotFoundError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc
    except (LastMasterError, LastAdministratorError) as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    await rooms_repo.delete_membership(session, room_id, user_id)
    # Their Characters stay, unlinked (D-15, D-23).
    await documents_repo.clear_played_by_in_room(session, room_id, user_id)
    # What they had read goes too (spec 19b): rejoining starts afresh.
    await reads_repo.delete_reads_in_room(session, room_id, user_id)
    # So are the Reveals they hadn't opened (spec 22).
    await reveals_repo.delete_recipients_in_room(session, room_id, user_id)
    await rooms_repo.insert_audit_log(session, audit_entry)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> None:
    """Spec 13: a Room Administrator permanently deletes the Room with all it
    holds - members, invitations, Tags, Documents, Comments, Notes, images and
    PDF Attachments. 403 for a non-member and for a member who isn't an
    Administrator (the Master alone isn't enough). The Room's AuditLog rows go
    with it. Every image and file is queued for Storage removal before the
    rows cascade away, so no object is left orphaned."""
    membership = await rooms_repo.get_membership(session, room_id, uuid.UUID(current_user.id))
    if membership is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.room.notAMember", locale)
    if not membership.is_admin:
        raise http_error(
            status.HTTP_403_FORBIDDEN, "errors.room.onlyAdministratorCanDelete", locale
        )

    await rooms_repo.lock_room(session, room_id)
    # Locked first so a concurrent image or file upload can't insert a row
    # the cascade would then delete without scheduling its Storage object.
    document_ids = await documents_repo.lock_documents_for_room(session, room_id)
    by_document = await documents_repo.list_images_for_documents(session, document_ids)
    images = [image for document_images in by_document.values() for image in document_images]
    if images:
        await remove_images(session, images)
    files_by_document = await files_repo.list_files_for_documents(session, document_ids)
    files = [file for document_files in files_by_document.values() for file in document_files]
    if files:
        await remove_files(session, files)
    # Finished Room PDFs live in Storage too (spec 23b), their rows cascade.
    exports = await export_jobs_repo.list_paths_in_room(session, room_id)
    if exports:
        await storage_cleanup.schedule_removal(session, exports)
    # So does the Room's own image (spec 26).
    room = await rooms_repo.get_room(session, room_id)
    if room is not None and room.image_path is not None:
        await storage_cleanup.schedule_removal(session, [room.image_path])
    await rooms_repo.delete_room(session, room_id)

import uuid
from collections.abc import Mapping

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.profiles import ProfileFields, profile_fields, sign_avatars
from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo, users_repo
from app.db.session import SessionDep
from app.domain.memberships import (
    LastAdministratorError,
    LastMasterError,
    MemberNotFoundError,
    NoChangeRequestedError,
    plan_removal,
    plan_role_change,
)
from app.domain.models import Membership, Room, RoomRole, RoomStatus, UserProfile
from app.domain.rooms import RoomNameRequiredError, plan_new_room

router = APIRouter(prefix="/rooms", tags=["rooms"])


class CreateRoomRequest(BaseModel):
    name: str
    game_system: str | None = None


class RoomResponse(BaseModel):
    id: uuid.UUID
    name: str
    game_system: str | None
    status: RoomStatus
    players_can_create_documents: bool


class MyRoomResponse(BaseModel):
    room: RoomResponse
    role: RoomRole
    is_admin: bool


class MemberResponse(ProfileFields):
    user_id: uuid.UUID
    role: RoomRole
    is_admin: bool


class UpdateMemberRequest(BaseModel):
    role: RoomRole | None = None
    is_admin: bool | None = None


class UpdateRoomSettingsRequest(BaseModel):
    players_can_create_documents: bool


def member_response(
    membership: Membership, profile: UserProfile, avatar_urls: Mapping[str, str]
) -> MemberResponse:
    return MemberResponse(
        user_id=membership.user_id,
        role=membership.role,
        is_admin=membership.is_admin,
        **profile_fields(profile, avatar_urls).model_dump(),
    )


def room_to_response(room: Room) -> RoomResponse:
    return RoomResponse(
        id=room.id,
        name=room.name,
        game_system=room.game_system,
        status=room.status,
        players_can_create_documents=room.players_can_create_documents,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_room(
    body: CreateRoomRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> RoomResponse:
    try:
        plan = plan_new_room(body.name, body.game_system, uuid.UUID(current_user.id))
    except RoomNameRequiredError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    await rooms_repo.insert_new_room(session, plan)
    await users_repo.upsert_user(session, plan.room.created_by, current_user.email)

    return room_to_response(plan.room)


@router.get("")
async def list_my_rooms(current_user: CurrentUserDep, session: SessionDep) -> list[MyRoomResponse]:
    rows = await rooms_repo.list_rooms_for_user(session, uuid.UUID(current_user.id))
    return [
        MyRoomResponse(
            room=room_to_response(room), role=membership.role, is_admin=membership.is_admin
        )
        for room, membership in rows
    ]


@router.get("/{room_id}")
async def get_room(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep
) -> RoomResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    room = await rooms_repo.get_room(session, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    return room_to_response(room)


@router.patch("/{room_id}")
async def update_room_settings(
    room_id: uuid.UUID,
    body: UpdateRoomSettingsRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> RoomResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None or membership.role != RoomRole.MASTER:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the Master can change this Room's settings"
        )

    try:
        await rooms_repo.set_players_can_create_documents(
            session, room_id, body.players_can_create_documents
        )
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found") from exc

    room = await rooms_repo.get_room(session, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    return room_to_response(room)


@router.get("/{room_id}/members")
async def list_members(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep
) -> list[MemberResponse]:
    requester_id = uuid.UUID(current_user.id)
    requester = await rooms_repo.get_membership(session, room_id, requester_id)
    if requester is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    rows = await rooms_repo.list_members_with_profile(session, room_id)
    avatar_urls = await sign_avatars(profile for _, profile in rows)
    return [member_response(membership, profile, avatar_urls) for membership, profile in rows]


@router.patch("/{room_id}/members/{user_id}")
async def update_member(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    body: UpdateMemberRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> MemberResponse:
    requester_id = uuid.UUID(current_user.id)
    requester = await rooms_repo.get_membership(session, room_id, requester_id)
    if requester is None or not requester.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a Room Administrator can change roles")

    memberships = await rooms_repo.list_memberships(session, room_id)
    try:
        plan = plan_role_change(memberships, user_id, requester_id, body.role, body.is_admin)
    except MemberNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except NoChangeRequestedError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except (LastMasterError, LastAdministratorError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    await rooms_repo.update_membership(session, plan.membership)
    await rooms_repo.insert_audit_log(session, plan.audit_entry)

    profile = await users_repo.get_profile(session, user_id)
    return member_response(plan.membership, profile, await sign_avatars([profile]))


@router.delete("/{room_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    room_id: uuid.UUID,
    user_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> None:
    requester_id = uuid.UUID(current_user.id)
    is_self = requester_id == user_id

    if not is_self:
        requester = await rooms_repo.get_membership(session, room_id, requester_id)
        if requester is None or not requester.is_admin:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only a Room Administrator can remove members"
            )

    memberships = await rooms_repo.list_memberships(session, room_id)
    try:
        audit_entry = plan_removal(memberships, user_id, requester_id, is_self=is_self)
    except MemberNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except (LastMasterError, LastAdministratorError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    await rooms_repo.delete_membership(session, room_id, user_id)
    await rooms_repo.insert_audit_log(session, audit_entry)

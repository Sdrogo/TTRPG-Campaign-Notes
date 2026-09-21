import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

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
from app.domain.models import RoomRole, RoomStatus
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


class MyRoomResponse(BaseModel):
    room: RoomResponse
    role: RoomRole
    is_admin: bool


class MemberResponse(BaseModel):
    user_id: uuid.UUID
    email: str | None
    role: RoomRole
    is_admin: bool


class UpdateMemberRequest(BaseModel):
    role: RoomRole | None = None
    is_admin: bool | None = None


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

    return RoomResponse(
        id=plan.room.id,
        name=plan.room.name,
        game_system=plan.room.game_system,
        status=plan.room.status,
    )


@router.get("")
async def list_my_rooms(current_user: CurrentUserDep, session: SessionDep) -> list[MyRoomResponse]:
    rows = await rooms_repo.list_rooms_for_user(session, uuid.UUID(current_user.id))
    return [
        MyRoomResponse(
            room=RoomResponse(
                id=room.id, name=room.name, game_system=room.game_system, status=room.status
            ),
            role=membership.role,
            is_admin=membership.is_admin,
        )
        for room, membership in rows
    ]


@router.get("/{room_id}/members")
async def list_members(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep
) -> list[MemberResponse]:
    requester_id = uuid.UUID(current_user.id)
    requester = await rooms_repo.get_membership(session, room_id, requester_id)
    if requester is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    rows = await rooms_repo.list_members_with_email(session, room_id)
    return [
        MemberResponse(user_id=m.user_id, email=email, role=m.role, is_admin=m.is_admin)
        for m, email in rows
    ]


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

    email = await users_repo.get_email(session, user_id)
    return MemberResponse(
        user_id=plan.membership.user_id,
        email=email,
        role=plan.membership.role,
        is_admin=plan.membership.is_admin,
    )


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

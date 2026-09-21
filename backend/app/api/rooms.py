import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import CurrentUserDep
from app.db import rooms_repo
from app.db.session import SessionDep
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

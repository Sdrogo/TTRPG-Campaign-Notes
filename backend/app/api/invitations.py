import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.api.rooms import RoomResponse, room_to_response
from app.auth.dependencies import CurrentUserDep
from app.db import invitations_repo, rooms_repo, users_repo
from app.db.session import SessionDep
from app.domain.invitations import (
    DEFAULT_INVITE_TTL,
    AlreadyMemberError,
    InvitationInvalidError,
    check_invitation_usable,
    plan_accepted_membership,
    plan_new_invitation,
)
from app.domain.models import RoomRole

router = APIRouter(tags=["invitations"])


class CreateInvitationRequest(BaseModel):
    role: RoomRole = RoomRole.PLAYER
    ttl_days: int | None = None


class InvitationResponse(BaseModel):
    code: str
    role: RoomRole
    expires_at: datetime | None


@router.post("/rooms/{room_id}/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(
    room_id: uuid.UUID,
    body: CreateInvitationRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> InvitationResponse:
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None or not membership.is_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only a Room Administrator can create invitations"
        )

    ttl = timedelta(days=body.ttl_days) if body.ttl_days else DEFAULT_INVITE_TTL
    invitation = plan_new_invitation(room_id, body.role, requester_id, ttl=ttl)
    await invitations_repo.insert_invitation(session, invitation)

    return InvitationResponse(
        code=invitation.code, role=invitation.role, expires_at=invitation.expires_at
    )


@router.post("/invitations/{code}/accept")
async def accept_invitation(
    code: str,
    current_user: CurrentUserDep,
    session: SessionDep,
) -> RoomResponse:
    invitation = await invitations_repo.get_invitation_by_code(session, code)
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")

    try:
        check_invitation_usable(invitation)
    except InvitationInvalidError as exc:
        raise HTTPException(status.HTTP_410_GONE, str(exc)) from exc

    user_id = uuid.UUID(current_user.id)
    existing = await rooms_repo.get_membership(session, invitation.room_id, user_id)
    try:
        membership = plan_accepted_membership(
            invitation, user_id, already_member=existing is not None
        )
    except AlreadyMemberError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    await rooms_repo.insert_membership(session, membership)
    await users_repo.upsert_user(session, user_id, current_user.email)

    room = await rooms_repo.get_room(session, invitation.room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")

    return room_to_response(room)

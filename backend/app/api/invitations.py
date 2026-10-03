"""Joining a Room by invitation (FR-R2, FR-R3): an Administrator creates a code
with a proposed role, and whoever opens it joins with that role. A direct
invitation (FR-F5, spec 18_1b) is addressed to one Friend instead: only they
may accept it, and they find it in `GET /invitations/mine`."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, status
from pydantic import BaseModel

from app.api.errors import http_error, translated_error
from app.api.profiles import ProfileFields, profile_fields, sign_avatars
from app.api.rooms import RoomResponse, room_to_response
from app.auth.dependencies import CurrentUserDep
from app.db import friends_repo, invitations_repo, rooms_repo, users_repo
from app.db.session import SessionDep
from app.domain.invitations import (
    DEFAULT_INVITE_TTL,
    AlreadyMemberError,
    InvitationInvalidError,
    NotAFriendError,
    NotTheInviteeError,
    check_invitation_for,
    check_invitation_usable,
    plan_accepted_membership,
    plan_decline,
    plan_direct_invitation,
    plan_new_invitation,
)
from app.domain.models import RoomRole
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["invitations"])


class CreateInvitationRequest(BaseModel):
    """The role the invitee will join with, and how many days the code stays
    valid (`DEFAULT_INVITE_TTL` when omitted)."""

    role: RoomRole = RoomRole.PLAYER
    ttl_days: int | None = None


class InvitationResponse(BaseModel):
    """The code, its role and when it expires. `invitee_user_id` is set for a
    direct invitation (only that user may accept it), null for a link."""

    code: str
    role: RoomRole
    expires_at: datetime | None
    invitee_user_id: uuid.UUID | None = None


class DirectInvitationRequest(BaseModel):
    """The Friend to invite and the role they would join with."""

    user_id: uuid.UUID
    role: RoomRole = RoomRole.PLAYER


class InviterResponse(ProfileFields):
    """Who sent a direct invitation, with the profile fields a Friend sees
    (no email, NFR-03)."""

    user_id: uuid.UUID


class MyInvitationResponse(BaseModel):
    """A direct invitation the caller can still accept: its code (for
    `POST /invitations/{code}/accept`), role, expiry, Room and sender."""

    code: str
    role: RoomRole
    expires_at: datetime | None
    room: RoomResponse
    invited_by: InviterResponse


@router.post("/rooms/{room_id}/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(
    room_id: uuid.UUID,
    body: CreateInvitationRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> InvitationResponse:
    """UC-03: an Administrator creates an invitation for their Room."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None or not membership.is_admin:
        raise http_error(
            status.HTTP_403_FORBIDDEN, "errors.invitation.onlyAdministratorCanInvite", locale
        )

    ttl = timedelta(days=body.ttl_days) if body.ttl_days else DEFAULT_INVITE_TTL
    invitation = plan_new_invitation(room_id, body.role, requester_id, ttl=ttl)
    await invitations_repo.insert_invitation(session, invitation)

    return InvitationResponse(
        code=invitation.code, role=invitation.role, expires_at=invitation.expires_at
    )


@router.post("/rooms/{room_id}/invitations/direct", status_code=status.HTTP_201_CREATED)
async def create_direct_invitation(
    room_id: uuid.UUID,
    body: DirectInvitationRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> InvitationResponse:
    """FR-F5: an Administrator invites one of their Friends into the Room with
    a proposed role. The Friend joins only by accepting it (D-26). 403 for a
    non-Administrator or a user who isn't the caller's Friend, 409 when they
    are already a member. A new invitation to the same Friend replaces the
    one still open (the latest role wins)."""
    requester_id = uuid.UUID(current_user.id)
    membership = await rooms_repo.get_membership(session, room_id, requester_id)
    if membership is None or not membership.is_admin:
        raise http_error(
            status.HTTP_403_FORBIDDEN, "errors.invitation.onlyAdministratorCanInvite", locale
        )

    # Serializes invitations to this Room, so two concurrent ones to the same
    # Friend can't both stay open.
    await rooms_repo.lock_room(session, room_id)
    # Locking the Friendship makes a concurrent removal wait, so its
    # revocation (D-26) sees this invitation.
    is_friend = await friends_repo.are_friends(session, requester_id, body.user_id, for_update=True)
    invitee_membership = await rooms_repo.get_membership(session, room_id, body.user_id)
    try:
        invitation = plan_direct_invitation(
            room_id,
            body.role,
            requester_id,
            body.user_id,
            is_friend=is_friend,
            invitee_is_member=invitee_membership is not None,
        )
    except NotAFriendError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except AlreadyMemberError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    await invitations_repo.revoke_pending_direct(session, room_id, body.user_id, datetime.now(UTC))
    await invitations_repo.insert_invitation(session, invitation)
    return InvitationResponse(
        code=invitation.code,
        role=invitation.role,
        expires_at=invitation.expires_at,
        invitee_user_id=invitation.invitee_id,
    )


@router.get("/invitations/mine")
async def list_my_invitations(
    current_user: CurrentUserDep, session: SessionDep
) -> list[MyInvitationResponse]:
    """The direct invitations addressed to the caller that they can still
    accept, oldest first: expired, revoked ones and those for a Room they
    already joined are left out. Link invitations never appear here."""
    user_id = uuid.UUID(current_user.id)
    rows = await invitations_repo.list_open_direct_for(session, user_id, datetime.now(UTC))
    inviter_ids = {invitation.created_by for invitation, _ in rows}
    profiles = await users_repo.get_profiles(session, inviter_ids)
    avatar_urls = await sign_avatars(profiles.values())

    def inviter(inviter_id: uuid.UUID) -> InviterResponse:
        fields = profile_fields(profiles[inviter_id], avatar_urls, user_id)
        return InviterResponse(user_id=inviter_id, **fields.model_dump())

    return [
        MyInvitationResponse(
            code=invitation.code,
            role=invitation.role,
            expires_at=invitation.expires_at,
            room=room_to_response(room),
            invited_by=inviter(invitation.created_by),
        )
        for invitation, room in rows
    ]


@router.post("/invitations/{code}/accept")
async def accept_invitation(
    code: str,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RoomResponse:
    """UC-04: the caller joins the invitation's Room with its proposed role.
    404 for an unknown code or a direct invitation addressed to someone else,
    410 when it has expired or been revoked, 409 when the caller is already a
    member."""
    invitation = await invitations_repo.get_invitation_by_code(session, code)
    if invitation is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.invitation.notFound", locale)
    user_id = uuid.UUID(current_user.id)
    try:
        check_invitation_for(invitation, user_id)
    except NotTheInviteeError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc

    try:
        check_invitation_usable(invitation)
    except InvitationInvalidError as exc:
        raise translated_error(status.HTTP_410_GONE, exc, locale) from exc

    existing = await rooms_repo.get_membership(session, invitation.room_id, user_id)
    try:
        membership = plan_accepted_membership(
            invitation, user_id, already_member=existing is not None
        )
    except AlreadyMemberError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    await rooms_repo.insert_membership(session, membership)
    await users_repo.upsert_user(session, user_id, current_user.email)

    room = await rooms_repo.get_room(session, invitation.room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)

    return room_to_response(room)


@router.post("/invitations/{code}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_invitation(
    code: str, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> None:
    """The invitee turns down a direct invitation (spec 18_1b): it is
    revoked and leaves `GET /invitations/mine`, silently for the sender. 404
    for an unknown code, a link invitation or one addressed to someone else,
    410 when it has already expired or been revoked."""
    invitation = await invitations_repo.get_invitation_by_code(session, code)
    if invitation is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.invitation.notFound", locale)
    try:
        declined = plan_decline(invitation, uuid.UUID(current_user.id), datetime.now(UTC))
    except NotTheInviteeError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc
    except InvitationInvalidError as exc:
        raise translated_error(status.HTTP_410_GONE, exc, locale) from exc
    await invitations_repo.revoke_invitation(session, declined.id, datetime.now(UTC))

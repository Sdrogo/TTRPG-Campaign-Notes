"""Friendships (D-26, D-27, FR-F1 to FR-F4, spec 18_1a): requests, answers,
removal and the caller's Friend code. Not scoped to a Room, so every route
acts on the caller like `/account` does, with no user id for "me" in the
path."""

import uuid
from collections.abc import Collection, Mapping
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import http_error, translated_error
from app.api.profiles import ProfileFields, profile_fields, sign_avatars
from app.auth.dependencies import CurrentUser, CurrentUserDep
from app.db import friends_repo, invitations_repo, rooms_repo, users_repo
from app.db.session import SessionDep
from app.domain.friends import (
    AlreadyFriendsError,
    AnswerInsteadError,
    FriendshipNotFoundError,
    FriendshipView,
    IncomingRequestPendingError,
    NoSharedRoomError,
    NotRecipientError,
    RequestAlreadySentError,
    RequestCooldownError,
    RequestNotPendingError,
    SelfFriendRequestError,
    plan_friend_code,
    plan_removal,
    plan_request,
    plan_response,
    view_for,
)
from app.domain.models import FriendCode, Friendship, FriendshipStatus, UserProfile
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["friends"])


class FriendResponse(ProfileFields):
    """The other user of a Friendship or request, seen by the caller, with
    the same profile fields a members list carries (no email, NFR-03).
    `since` is when the Friendship was accepted,
    or when the request was sent. `friendship_id` is what accept and
    decline take."""

    friendship_id: uuid.UUID
    user_id: uuid.UUID
    since: datetime


class FriendsResponse(BaseModel):
    """FR-F3: the caller's Friends and the requests they received and sent.
    A request the caller sent and was declined still shows in `outgoing`
    (declining is silent, D-27)."""

    friends: list[FriendResponse]
    incoming: list[FriendResponse]
    outgoing: list[FriendResponse]


class FriendRequestBody(BaseModel):
    """Exactly one of `user_id` (a member of a Room the caller shares) or
    `code` (the recipient's Friend code), D-27."""

    user_id: uuid.UUID | None = None
    code: str | None = None


class FriendCodeResponse(BaseModel):
    """The caller's Friend code, to share as a code or inside a link."""

    code: str
    created_at: datetime


async def _responses(
    session: AsyncSession, caller_id: uuid.UUID, friendships: Collection[Friendship]
) -> dict[uuid.UUID, FriendResponse]:
    """Serializes each row from the caller's side, keyed by row id, in a
    fixed number of queries: profiles, one signing request."""
    other_ids = {friendship.other(caller_id) for friendship in friendships}
    profiles = await users_repo.get_profiles(session, other_ids)
    avatar_urls = await sign_avatars(profiles.values())
    return {
        friendship.id: _response(
            friendship, caller_id, profiles[friendship.other(caller_id)], avatar_urls
        )
        for friendship in friendships
    }


def _response(
    friendship: Friendship,
    caller_id: uuid.UUID,
    profile: UserProfile,
    avatar_urls: Mapping[str, str],
) -> FriendResponse:
    """One row from the caller's side."""
    fields = profile_fields(profile, avatar_urls, caller_id)
    is_friend = view_for(friendship, caller_id) is FriendshipView.FRIEND
    since = friendship.responded_at if is_friend else None
    return FriendResponse(
        friendship_id=friendship.id,
        user_id=profile.user_id,
        since=since or friendship.created_at,
        **fields.model_dump(),
    )


async def _single_response(
    session: AsyncSession, caller_id: uuid.UUID, friendship: Friendship
) -> FriendResponse:
    """`_responses` for one row."""
    return (await _responses(session, caller_id, [friendship]))[friendship.id]


@router.get("/friends")
async def list_friends(current_user: CurrentUserDep, session: SessionDep) -> FriendsResponse:
    """FR-F3: the caller's Friends, incoming requests (to accept or decline)
    and outgoing ones (to cancel), oldest first. A request the caller
    declined is gone from their lists."""
    caller_id = uuid.UUID(current_user.id)
    rows = await friends_repo.list_for_user(session, caller_id)
    views = {row.id: view_for(row, caller_id) for row in rows}
    visible = [row for row in rows if views[row.id] is not None]
    responses = await _responses(session, caller_id, visible)

    def of(view: FriendshipView) -> list[FriendResponse]:
        return [responses[row.id] for row in visible if views[row.id] is view]

    return FriendsResponse(
        friends=of(FriendshipView.FRIEND),
        incoming=of(FriendshipView.INCOMING),
        outgoing=of(FriendshipView.OUTGOING),
    )


@router.post("/friends/requests", status_code=status.HTTP_201_CREATED)
async def send_friend_request(
    body: FriendRequestBody, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> FriendResponse:
    """FR-F1: asks a member of a Room the caller shares (`user_id`) or the
    owner of a Friend code (`code`) to become Friends. 422 without exactly
    one of them or for the caller themselves, 403 for a `user_id` sharing no
    Room with the caller, 404 for an unknown code, 409 when they are already
    Friends, a request is already pending either way, or the caller declined
    this user's request less than 30 days ago (D-27). Returns the request as
    the caller's `outgoing` entry.

    Declining is silent: if the recipient declined the caller's earlier
    request, re-sending inside the cooldown answers as if it were still
    pending, and nobody is asked again."""
    if (body.user_id is None) == (body.code is None):
        raise http_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.friend.userOrCode", locale)
    caller_id = uuid.UUID(current_user.id)
    if body.code is not None:
        target_id = await friends_repo.get_user_by_code(session, body.code)
        if target_id is None:
            raise http_error(status.HTTP_404_NOT_FOUND, "errors.friend.codeNotFound", locale)
    else:
        assert body.user_id is not None
        target_id = body.user_id

    await friends_repo.lock_pair(session, caller_id, target_id)
    existing = await friends_repo.get_between(session, caller_id, target_id, for_update=True)
    shares_room = bool(await rooms_repo.users_sharing_a_room(session, caller_id, [target_id]))
    try:
        plan = plan_request(
            caller_id,
            target_id,
            existing,
            via_code=body.code is not None,
            shares_room=shares_room,
            now=datetime.now(UTC),
        )
    except SelfFriendRequestError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc
    except NoSharedRoomError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except (
        AlreadyFriendsError,
        RequestAlreadySentError,
        IncomingRequestPendingError,
        RequestCooldownError,
    ) as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc

    if plan.is_new:
        await friends_repo.insert(session, plan.friendship)
    else:
        await friends_repo.save(session, plan.friendship)
    await users_repo.upsert_user(session, caller_id, current_user.email)
    return await _single_response(session, caller_id, plan.friendship)


async def _answer(
    friendship_id: uuid.UUID,
    accept: bool,
    current_user: CurrentUser,
    session: AsyncSession,
    locale: str,
) -> tuple[uuid.UUID, Friendship]:
    """Applies the recipient's answer, shared by accept and decline."""
    caller_id = uuid.UUID(current_user.id)
    friendship = await friends_repo.get_by_id(session, friendship_id, for_update=True)
    if friendship is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.friend.notFound", locale)
    try:
        answered = plan_response(friendship, caller_id, accept, datetime.now(UTC))
    except FriendshipNotFoundError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc
    except NotRecipientError as exc:
        raise translated_error(status.HTTP_403_FORBIDDEN, exc, locale) from exc
    except RequestNotPendingError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
    await friends_repo.save(session, answered)
    await users_repo.upsert_user(session, caller_id, current_user.email)
    return caller_id, answered


@router.post("/friends/requests/{friendship_id}/accept")
async def accept_friend_request(
    friendship_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> FriendResponse:
    """FR-F2: the recipient accepts; returns the new Friend. 404 for a
    request the caller can't see, 403 for its sender, 409 once answered."""
    caller_id, answered = await _answer(friendship_id, True, current_user, session, locale)
    return await _single_response(session, caller_id, answered)


@router.post("/friends/requests/{friendship_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline_friend_request(
    friendship_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> None:
    """FR-F2: the recipient declines, silently (D-27): the sender keeps
    seeing the request as pending and can't send another for 30 days. Same
    errors as accept."""
    await _answer(friendship_id, False, current_user, session, locale)


@router.delete("/friends/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_friend(
    user_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> None:
    """FR-F2: ends a Friendship (either Friend) or cancels a request the
    caller sent, silently for the other user. 404 when there's nothing
    between them the caller can see, 409 for a request the caller received
    (they accept or decline it instead)."""
    caller_id = uuid.UUID(current_user.id)
    friendship = await friends_repo.get_between(session, caller_id, user_id, for_update=True)
    if friendship is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.friend.notFound", locale)
    try:
        plan = plan_removal(friendship, caller_id)
    except FriendshipNotFoundError as exc:
        raise translated_error(status.HTTP_404_NOT_FOUND, exc, locale) from exc
    except AnswerInsteadError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
    if plan.delete:
        await friends_repo.delete_friendship(session, friendship.id)
        if friendship.status is FriendshipStatus.ACCEPTED:
            await invitations_repo.revoke_direct_between(
                session, caller_id, user_id, datetime.now(UTC)
            )
    else:
        await friends_repo.save(session, plan.friendship)


def _code_response(code: FriendCode) -> FriendCodeResponse:
    """Serializes a Friend code."""
    return FriendCodeResponse(code=code.code, created_at=code.created_at)


@router.get("/account/friend-code")
async def get_friend_code(current_user: CurrentUserDep, session: SessionDep) -> FriendCodeResponse:
    """FR-F4: the caller's Friend code, created on first use."""
    caller_id = uuid.UUID(current_user.id)
    code = await friends_repo.ensure_code(session, plan_friend_code(caller_id, datetime.now(UTC)))
    return _code_response(code)


@router.post("/account/friend-code", status_code=status.HTTP_201_CREATED)
async def regenerate_friend_code(
    current_user: CurrentUserDep, session: SessionDep
) -> FriendCodeResponse:
    """FR-F4: replaces the caller's Friend code with a new one; the old code
    and any link built from it stop working at once. Requests already sent
    with it are unaffected."""
    code = plan_friend_code(uuid.UUID(current_user.id), datetime.now(UTC))
    await friends_repo.replace_code(session, code)
    return _code_response(code)

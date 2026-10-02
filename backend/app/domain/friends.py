"""Rules for Friendships (D-26, D-27, FR-F1 to FR-F4, spec 18): who may ask
whom, who answers, what removing does, and what each side of the pair gets
to see. The first concept not scoped to a Room."""

import secrets
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import FriendCode, Friendship, FriendshipStatus

REQUEST_COOLDOWN = timedelta(days=30)


class SelfFriendRequestError(DomainError):
    """A user tried to befriend themselves."""


class NoSharedRoomError(DomainError):
    """A request by user id needs the two users to share a Room right now
    (D-27); otherwise only the Friend code works."""


class AlreadyFriendsError(DomainError):
    """The two users are already Friends."""


class RequestAlreadySentError(DomainError):
    """The requester already has a pending request to this user."""


class IncomingRequestPendingError(DomainError):
    """The other user has already sent a request to the requester, who
    should answer it instead of sending a second one."""


class RequestCooldownError(DomainError):
    """The requester declined this user's request less than
    `REQUEST_COOLDOWN` ago (D-27)."""


class FriendshipNotFoundError(DomainError):
    """No Friendship or request between these users that the caller can see
    or act on."""


class NotRecipientError(DomainError):
    """Only the user a request was sent to may accept or decline it."""


class RequestNotPendingError(DomainError):
    """The request was already answered."""


class AnswerInsteadError(DomainError):
    """The recipient of a pending request tried to remove it: they accept or
    decline it instead, so a decline always starts the cooldown."""


class FriendshipView(StrEnum):
    """How a Friendship row appears to one of its two users."""

    FRIEND = "friend"
    INCOMING = "incoming"
    OUTGOING = "outgoing"


@dataclass(frozen=True)
class RequestPlan:
    """The row to write for a request: inserted when `is_new`, otherwise an
    update of the existing row for the pair."""

    friendship: Friendship
    is_new: bool


@dataclass(frozen=True)
class RemovalPlan:
    """`delete` removes the row; otherwise `friendship` is the row to save
    (a declined request hidden from its sender, kept for the cooldown)."""

    delete: bool
    friendship: Friendship


def ordered_pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """The pair in storage order, so one row covers both directions."""
    return (a, b) if a < b else (b, a)


def view_for(friendship: Friendship, viewer_id: uuid.UUID) -> FriendshipView | None:
    """What `viewer_id` sees of the row, or None when it is hidden from them.

    Declining is silent (D-27): the sender keeps seeing a declined request
    as an outgoing one until they cancel it, and the user who declined no
    longer sees it at all."""
    if friendship.status is FriendshipStatus.ACCEPTED:
        return FriendshipView.FRIEND
    sent = friendship.requested_by == viewer_id
    if friendship.status is FriendshipStatus.PENDING:
        return FriendshipView.OUTGOING if sent else FriendshipView.INCOMING
    if sent and not friendship.hidden_from_sender:
        return FriendshipView.OUTGOING
    return None


def plan_request(
    requester_id: uuid.UUID,
    target_id: uuid.UUID,
    existing: Friendship | None,
    *,
    via_code: bool,
    shares_room: bool,
    now: datetime,
) -> RequestPlan:
    """FR-F1: a request to a member of a shared Room, or to whoever owns the
    Friend code used (`via_code`). At most one row per pair, so no duplicate
    in either direction.

    A declined row is reused once `REQUEST_COOLDOWN` has passed since the
    decline, by either user: the requester becomes its sender and only the
    other user can answer. Before that, the user who declined is refused,
    while the sender, who was never told, is answered exactly as if the
    request were still pending (a cancelled one simply reappears), so the
    decline stays silent and the recipient is not asked again."""
    if requester_id == target_id:
        raise SelfFriendRequestError("errors.friend.self")
    if not via_code and not shares_room:
        raise NoSharedRoomError("errors.friend.noSharedRoom")

    if existing is None:
        low, high = ordered_pair(requester_id, target_id)
        friendship = Friendship(
            id=uuid.uuid4(),
            user_low=low,
            user_high=high,
            requested_by=requester_id,
            status=FriendshipStatus.PENDING,
            created_at=now,
        )
        return RequestPlan(friendship=friendship, is_new=True)

    if existing.status is FriendshipStatus.ACCEPTED:
        raise AlreadyFriendsError("errors.friend.alreadyFriends")
    sent = existing.requested_by == requester_id
    if existing.status is FriendshipStatus.PENDING:
        if sent:
            raise RequestAlreadySentError("errors.friend.alreadyRequested")
        raise IncomingRequestPendingError("errors.friend.incomingPending")

    declined_at = existing.responded_at or existing.created_at
    if now - declined_at >= REQUEST_COOLDOWN:
        renewed = replace(
            existing,
            requested_by=requester_id,
            status=FriendshipStatus.PENDING,
            created_at=now,
            responded_at=None,
            hidden_from_sender=False,
        )
        return RequestPlan(friendship=renewed, is_new=False)
    if not sent:
        raise RequestCooldownError("errors.friend.cooldown")
    if not existing.hidden_from_sender:
        raise RequestAlreadySentError("errors.friend.alreadyRequested")
    return RequestPlan(friendship=replace(existing, hidden_from_sender=False), is_new=False)


def plan_response(
    friendship: Friendship, user_id: uuid.UUID, accept: bool, now: datetime
) -> Friendship:
    """FR-F2: only the recipient answers, and only once. Declining keeps the
    row as `declined`, timed for the cooldown. The sender of a declined
    request gets the same refusal as for a pending one, so answering can't
    reveal the decline."""
    if not friendship.involves(user_id) or view_for(friendship, user_id) is None:
        raise FriendshipNotFoundError("errors.friend.notFound")
    if friendship.requested_by == user_id:
        raise NotRecipientError("errors.friend.notRecipient")
    if friendship.status is not FriendshipStatus.PENDING:
        raise RequestNotPendingError("errors.friend.notPending")
    status = FriendshipStatus.ACCEPTED if accept else FriendshipStatus.DECLINED
    return replace(friendship, status=status, responded_at=now)


def plan_removal(friendship: Friendship, user_id: uuid.UUID) -> RemovalPlan:
    """FR-F2: either Friend removes the Friendship, and the sender cancels a
    pending request; both delete the row, silently for the other user. The
    recipient of a pending request answers it rather than removing it.

    A declined row is never deleted, so the cooldown survives: its sender's
    cancel only hides it from them (they were never told it was declined),
    and the user who declined has nothing left to remove."""
    if not friendship.involves(user_id) or view_for(friendship, user_id) is None:
        raise FriendshipNotFoundError("errors.friend.notFound")
    if friendship.status is FriendshipStatus.ACCEPTED:
        return RemovalPlan(delete=True, friendship=friendship)
    if friendship.requested_by != user_id:
        raise AnswerInsteadError("errors.friend.answerInstead")
    if friendship.status is FriendshipStatus.PENDING:
        return RemovalPlan(delete=True, friendship=friendship)
    return RemovalPlan(delete=False, friendship=replace(friendship, hidden_from_sender=True))


def plan_friend_code(user_id: uuid.UUID, now: datetime) -> FriendCode:
    """FR-F4: a fresh random code (12 URL-safe characters, 72 bits, like an
    invitation code), not guessable, so knowing it is what lets a stranger
    send a request (D-27)."""
    return FriendCode(user_id=user_id, code=secrets.token_urlsafe(9), created_at=now)

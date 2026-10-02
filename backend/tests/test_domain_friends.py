import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.friends import (
    REQUEST_COOLDOWN,
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
    ordered_pair,
    plan_friend_code,
    plan_removal,
    plan_request,
    plan_response,
    view_for,
)
from app.domain.models import Friendship, FriendshipStatus

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=UTC)
ALICE = uuid.UUID("00000000-0000-0000-0000-00000000000a")
BOB = uuid.UUID("00000000-0000-0000-0000-00000000000b")
CAROL = uuid.UUID("00000000-0000-0000-0000-00000000000c")


def _friendship(
    requested_by: uuid.UUID = ALICE,
    status: FriendshipStatus = FriendshipStatus.PENDING,
    responded_at: datetime | None = None,
    hidden_from_sender: bool = False,
) -> Friendship:
    low, high = ordered_pair(ALICE, BOB)
    return Friendship(
        id=uuid.uuid4(),
        user_low=low,
        user_high=high,
        requested_by=requested_by,
        status=status,
        created_at=NOW - timedelta(days=40),
        responded_at=responded_at,
        hidden_from_sender=hidden_from_sender,
    )


def _declined(days_ago: float, hidden: bool = False) -> Friendship:
    """Alice asked, Bob declined `days_ago` days before NOW."""
    return _friendship(
        status=FriendshipStatus.DECLINED,
        responded_at=NOW - timedelta(days=days_ago),
        hidden_from_sender=hidden,
    )


def _request(
    requester: uuid.UUID,
    target: uuid.UUID,
    existing: Friendship | None,
    via_code: bool = False,
    shares_room: bool = True,
) -> Friendship:
    return plan_request(
        requester, target, existing, via_code=via_code, shares_room=shares_room, now=NOW
    ).friendship


def test_ordered_pair_is_the_same_both_ways() -> None:
    assert ordered_pair(BOB, ALICE) == ordered_pair(ALICE, BOB) == (ALICE, BOB)


def test_friendship_knows_its_recipient_and_the_other_user() -> None:
    friendship = _friendship(requested_by=BOB)
    assert friendship.recipient == ALICE
    assert friendship.other(ALICE) == BOB
    assert friendship.involves(BOB)
    assert not friendship.involves(CAROL)


# --- plan_request (FR-F1, D-27) ---


def test_new_request_stores_the_pair_ordered_with_its_sender() -> None:
    plan = plan_request(BOB, ALICE, None, via_code=False, shares_room=True, now=NOW)
    assert plan.is_new
    friendship = plan.friendship
    assert (friendship.user_low, friendship.user_high) == (ALICE, BOB)
    assert friendship.requested_by == BOB
    assert friendship.recipient == ALICE
    assert friendship.status is FriendshipStatus.PENDING
    assert friendship.created_at == NOW
    assert friendship.responded_at is None


def test_cannot_befriend_yourself() -> None:
    with pytest.raises(SelfFriendRequestError):
        _request(ALICE, ALICE, None, via_code=True)


def test_request_by_user_id_needs_a_shared_room() -> None:
    # D-27: no directory, so a user id only works for someone you play with.
    with pytest.raises(NoSharedRoomError):
        _request(ALICE, BOB, None, shares_room=False)


def test_request_by_code_needs_no_shared_room() -> None:
    assert _request(ALICE, BOB, None, via_code=True, shares_room=False).requested_by == ALICE


def test_no_request_between_friends() -> None:
    friends = _friendship(status=FriendshipStatus.ACCEPTED, responded_at=NOW)
    with pytest.raises(AlreadyFriendsError):
        _request(BOB, ALICE, friends)


def test_no_duplicate_request_in_the_same_direction() -> None:
    with pytest.raises(RequestAlreadySentError):
        _request(ALICE, BOB, _friendship(requested_by=ALICE))


def test_no_duplicate_request_in_the_other_direction() -> None:
    with pytest.raises(IncomingRequestPendingError):
        _request(BOB, ALICE, _friendship(requested_by=ALICE))


def test_decliner_cannot_ask_back_during_the_cooldown() -> None:
    with pytest.raises(RequestCooldownError):
        _request(BOB, ALICE, _declined(days_ago=29))


def test_sender_of_a_declined_request_is_told_it_is_still_pending() -> None:
    # D-27: declining is silent, so the sender gets the same answer as for a
    # real pending request, and the recipient isn't asked again.
    with pytest.raises(RequestAlreadySentError):
        _request(ALICE, BOB, _declined(days_ago=1))


def test_cancelled_declined_request_reappears_without_reaching_the_recipient() -> None:
    declined = _declined(days_ago=1, hidden=True)
    plan = plan_request(ALICE, BOB, declined, via_code=False, shares_room=True, now=NOW)
    assert not plan.is_new
    assert plan.friendship == replace(declined, hidden_from_sender=False)
    assert plan.friendship.status is FriendshipStatus.DECLINED


@pytest.mark.parametrize("requester", [ALICE, BOB])
def test_either_user_may_ask_again_after_the_cooldown(requester: uuid.UUID) -> None:
    declined = _declined(days_ago=REQUEST_COOLDOWN.days, hidden=True)
    plan = plan_request(
        requester, declined.other(requester), declined, via_code=False, shares_room=True, now=NOW
    )
    assert not plan.is_new
    renewed = plan.friendship
    assert renewed.id == declined.id
    assert renewed.requested_by == requester
    assert renewed.status is FriendshipStatus.PENDING
    assert renewed.created_at == NOW
    assert renewed.responded_at is None
    assert not renewed.hidden_from_sender


def test_cooldown_counts_from_creation_when_no_answer_time_was_stored() -> None:
    # created_at is 40 days before NOW in the fixture, past the cooldown.
    declined = _friendship(status=FriendshipStatus.DECLINED)
    assert _request(BOB, ALICE, declined).status is FriendshipStatus.PENDING


# --- view_for: what each side sees (D-27) ---


def test_views_of_a_pending_request() -> None:
    pending = _friendship(requested_by=ALICE)
    assert view_for(pending, ALICE) is FriendshipView.OUTGOING
    assert view_for(pending, BOB) is FriendshipView.INCOMING


def test_both_see_an_accepted_friendship() -> None:
    friends = _friendship(status=FriendshipStatus.ACCEPTED, responded_at=NOW)
    assert view_for(friends, ALICE) is FriendshipView.FRIEND
    assert view_for(friends, BOB) is FriendshipView.FRIEND


def test_declined_request_stays_outgoing_for_its_sender_only() -> None:
    declined = _declined(days_ago=1)
    assert view_for(declined, ALICE) is FriendshipView.OUTGOING
    assert view_for(declined, BOB) is None
    assert view_for(replace(declined, hidden_from_sender=True), ALICE) is None


# --- plan_response (FR-F2) ---


def test_recipient_accepts() -> None:
    accepted = plan_response(_friendship(requested_by=ALICE), BOB, accept=True, now=NOW)
    assert accepted.status is FriendshipStatus.ACCEPTED
    assert accepted.responded_at == NOW


def test_recipient_declines_and_the_time_is_kept_for_the_cooldown() -> None:
    declined = plan_response(_friendship(requested_by=ALICE), BOB, accept=False, now=NOW)
    assert declined.status is FriendshipStatus.DECLINED
    assert declined.responded_at == NOW


def test_only_the_recipient_answers() -> None:
    with pytest.raises(NotRecipientError):
        plan_response(_friendship(requested_by=ALICE), ALICE, accept=True, now=NOW)


def test_sender_of_a_declined_request_gets_the_same_refusal_as_for_a_pending_one() -> None:
    with pytest.raises(NotRecipientError):
        plan_response(_declined(days_ago=1), ALICE, accept=True, now=NOW)


def test_stranger_cannot_answer() -> None:
    with pytest.raises(FriendshipNotFoundError):
        plan_response(_friendship(requested_by=ALICE), CAROL, accept=True, now=NOW)


def test_decliner_no_longer_sees_the_request_to_answer() -> None:
    with pytest.raises(FriendshipNotFoundError):
        plan_response(_declined(days_ago=1), BOB, accept=True, now=NOW)


def test_an_accepted_friendship_cannot_be_answered_again() -> None:
    friends = _friendship(requested_by=ALICE, status=FriendshipStatus.ACCEPTED, responded_at=NOW)
    with pytest.raises(RequestNotPendingError):
        plan_response(friends, BOB, accept=False, now=NOW)


# --- plan_removal (FR-F2) ---


@pytest.mark.parametrize("remover", [ALICE, BOB])
def test_either_friend_removes_the_friendship(remover: uuid.UUID) -> None:
    friends = _friendship(status=FriendshipStatus.ACCEPTED, responded_at=NOW)
    assert plan_removal(friends, remover).delete


def test_sender_cancels_a_pending_request() -> None:
    assert plan_removal(_friendship(requested_by=ALICE), ALICE).delete


def test_recipient_answers_a_pending_request_rather_than_removing_it() -> None:
    with pytest.raises(AnswerInsteadError):
        plan_removal(_friendship(requested_by=ALICE), BOB)


def test_cancelling_a_declined_request_hides_it_but_keeps_the_cooldown() -> None:
    declined = _declined(days_ago=1)
    plan = plan_removal(declined, ALICE)
    assert not plan.delete
    assert plan.friendship == replace(declined, hidden_from_sender=True)


@pytest.mark.parametrize(
    ("friendship", "remover"),
    [
        (_declined(days_ago=1), BOB),
        (_declined(days_ago=1, hidden=True), ALICE),
        (_friendship(status=FriendshipStatus.ACCEPTED), CAROL),
    ],
    ids=["decliner", "sender-after-cancel", "stranger"],
)
def test_nothing_to_remove(friendship: Friendship, remover: uuid.UUID) -> None:
    with pytest.raises(FriendshipNotFoundError):
        plan_removal(friendship, remover)


# --- plan_friend_code (FR-F4) ---


def test_friend_codes_are_random_and_url_safe() -> None:
    first = plan_friend_code(ALICE, NOW)
    second = plan_friend_code(ALICE, NOW)
    assert first.user_id == ALICE
    assert first.created_at == NOW
    assert len(first.code) == 12
    assert first.code != second.code
    assert all(c.isalnum() or c in "-_" for c in first.code)

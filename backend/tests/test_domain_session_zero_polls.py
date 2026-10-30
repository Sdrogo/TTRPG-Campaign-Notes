"""The Poll module's pure rules (spec 53)."""

import uuid
from datetime import UTC, datetime

import pytest

from app.domain.models import RoomRole
from app.domain.session_zero import ModuleKind
from app.domain.session_zero_polls import (
    InvalidPollsError,
    InvalidVoteError,
    NotAVoterError,
    NotPollModuleError,
    OptionSpec,
    Poll,
    PollClosedError,
    PollResults,
    PollSettingsLockedError,
    PollSpec,
    VotersVisible,
    clean_polls,
    clean_vote,
    ensure_can_vote,
    ensure_poll_module,
    ensure_settings_kept,
    sees_names,
    sees_tally,
    winners,
)


def _spec(
    *options: str, max_choices: int = 1, hint: str | None = None, body: str = "Q"
) -> PollSpec:
    return PollSpec(
        id=None,
        body=body,
        hint=hint,
        max_choices=max_choices,
        master_votes=False,
        voters_visible=VotersVisible.MASTER,
        results=PollResults.LIVE,
        options=tuple(OptionSpec(None, option) for option in options),
    )


def _poll(**changes: object) -> Poll:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "module_id": uuid.uuid4(),
        "position": 0,
        "body": "Q",
        "hint": None,
        "max_choices": 1,
        "master_votes": False,
        "voters_visible": VotersVisible.MASTER,
        "results": PollResults.LIVE,
        "revealed": False,
        "closed_at": None,
    }
    values.update(changes)
    return Poll(**values)  # type: ignore[arg-type]


def test_only_a_poll_module_takes_polls() -> None:
    ensure_poll_module(ModuleKind.POLL)
    with pytest.raises(NotPollModuleError):
        ensure_poll_module(ModuleKind.DDI)


def test_clean_polls_trims_texts_and_drops_an_empty_hint() -> None:
    [cleaned] = clean_polls([_spec("  Yes ", "No", hint="   ", body=" Why? ")])
    assert cleaned.body == "Why?" and cleaned.hint is None
    assert [o.body for o in cleaned.options] == ["Yes", "No"]
    [hinted] = clean_polls([_spec("a", "b", hint=" pick ")])
    assert hinted.hint == "pick"


@pytest.mark.parametrize(
    ("specs", "key"),
    [
        ([_spec("a", "b")] * 11, "errors.sessionZero.tooManyPolls"),
        ([_spec("a")], "errors.sessionZero.pollOptions"),
        ([_spec(*[str(i) for i in range(21)])], "errors.sessionZero.pollOptions"),
        ([_spec("Yes", " yes ")], "errors.sessionZero.pollDuplicateOption"),
        ([_spec("a", "b", max_choices=0)], "errors.sessionZero.pollMaxChoices"),
        ([_spec("a", "b", max_choices=3)], "errors.sessionZero.pollMaxChoices"),
        ([_spec("a", " ")], "errors.sessionZero.pollText"),
        ([_spec("a", "b" * 201)], "errors.sessionZero.pollText"),
        ([_spec("a", "b", body="")], "errors.sessionZero.pollText"),
        ([_spec("a", "b", hint="h" * 301)], "errors.sessionZero.pollText"),
    ],
)
def test_clean_polls_rejects(specs: list[PollSpec], key: str) -> None:
    with pytest.raises(InvalidPollsError) as error:
        clean_polls(specs)
    assert str(error.value) == key


def test_settings_stay_once_a_poll_has_votes() -> None:
    poll = _poll()
    changed = _spec("a", "b", max_choices=2)
    ensure_settings_kept(changed, poll, has_votes=False)
    ensure_settings_kept(_spec("a", "b"), poll, has_votes=True)
    with pytest.raises(PollSettingsLockedError):
        ensure_settings_kept(changed, poll, has_votes=True)


def test_who_votes() -> None:
    ensure_can_vote(_poll(), RoomRole.PLAYER)
    ensure_can_vote(_poll(master_votes=True), RoomRole.MASTER)
    with pytest.raises(NotAVoterError):
        ensure_can_vote(_poll(), RoomRole.MASTER)
    with pytest.raises(PollClosedError):
        ensure_can_vote(_poll(closed_at=datetime.now(UTC)), RoomRole.PLAYER)


def test_clean_vote() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    poll = _poll(max_choices=2)
    assert clean_vote(poll, [a, b], {a, b}) == [a, b]
    assert clean_vote(poll, [], {a, b}) == []
    for bad in ([a, a], [a, b, b], [c]):
        with pytest.raises(InvalidVoteError):
            clean_vote(poll, bad, {a, b})
    with pytest.raises(InvalidVoteError):
        clean_vote(_poll(), [a, b], {a, b})


def test_tally_and_names() -> None:
    master, player = RoomRole.MASTER, RoomRole.PLAYER
    hidden = _poll(results=PollResults.HIDDEN)
    assert sees_tally(hidden, master) and not sees_tally(hidden, player)
    assert sees_tally(_poll(results=PollResults.HIDDEN, revealed=True), player)
    assert sees_names(_poll(), master) and not sees_names(_poll(), player)
    assert sees_names(_poll(voters_visible=VotersVisible.EVERYONE), player)
    assert not sees_names(
        _poll(voters_visible=VotersVisible.EVERYONE, results=PollResults.HIDDEN), player
    )
    assert not sees_names(_poll(voters_visible=VotersVisible.NOBODY), master)


def test_winners() -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    assert winners({a: 2, b: 2, c: 1}) == {a, b}
    assert winners({a: 0, b: 0}) == set()
    assert winners({}) == set()

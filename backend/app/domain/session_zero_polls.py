"""The Poll module of Session 0 (spec 53): the Master writes polls of 2 to
20 choices, each with its own settings (votes per person, whether the
Master votes, who sees who voted what, a live or secret tally), and the
table votes. Pure: the repository stores polls and votes, the API reads
them."""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.session_zero import ModuleKind

MAX_POLLS = 10
MIN_OPTIONS = 2
MAX_OPTIONS = 20
MAX_POLL_LENGTH = 200
MAX_HINT_LENGTH = 300
MAX_OPTION_LENGTH = 200


class VotersVisible(StrEnum):
    """Who sees who voted for each choice (Decision 2, Q4)."""

    MASTER = "master"
    EVERYONE = "everyone"
    NOBODY = "nobody"


class PollResults(StrEnum):
    """A live tally, or a secret one the Master reveals (Decision 2, Q5)."""

    LIVE = "live"
    HIDDEN = "hidden"


@dataclass(frozen=True)
class PollOption:
    """A choice of a poll."""

    id: uuid.UUID
    poll_id: uuid.UUID
    position: int
    body: str


@dataclass(frozen=True)
class Poll:
    """A poll of a Poll module, with its settings and state."""

    id: uuid.UUID
    module_id: uuid.UUID
    position: int
    body: str
    hint: str | None
    max_choices: int
    master_votes: bool
    voters_visible: VotersVisible
    results: PollResults
    revealed: bool
    closed_at: datetime | None

    @property
    def closed(self) -> bool:
        """Whether the Master closed it (Decision 6)."""
        return self.closed_at is not None


@dataclass(frozen=True)
class Vote:
    """One choice a member gave their vote to."""

    poll_id: uuid.UUID
    option_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime


@dataclass(frozen=True)
class OptionSpec:
    """A choice as the Master sends it; `id` keeps an existing one."""

    id: uuid.UUID | None
    body: str


@dataclass(frozen=True)
class PollSpec:
    """A poll as the Master sends it; `id` keeps an existing one."""

    id: uuid.UUID | None
    body: str
    hint: str | None
    max_choices: int
    master_votes: bool
    voters_visible: VotersVisible
    results: PollResults
    options: tuple[OptionSpec, ...]

    def same_settings(self, poll: Poll) -> bool:
        """Whether the four settings of Decision 2 are those of `poll`."""
        return (
            self.max_choices == poll.max_choices
            and self.master_votes == poll.master_votes
            and self.voters_visible is poll.voters_visible
            and self.results is poll.results
        )


class NotPollModuleError(DomainError):
    """The module isn't a Poll one."""


class InvalidPollsError(DomainError):
    """A list of polls breaking Decision 2."""


class PollSettingsLockedError(DomainError):
    """A poll's settings change only while it has no votes (Decision 3)."""


class PollClosedError(DomainError):
    """A closed poll takes no votes (Decision 6)."""


class InvalidVoteError(DomainError):
    """Too many choices, a repeated one or one of another poll."""


class NotAVoterError(DomainError):
    """The Master votes only on a poll that says so (Decision 2, Q3)."""


def ensure_poll_module(kind: ModuleKind) -> None:
    """422 for a module that isn't a Poll one."""
    if kind is not ModuleKind.POLL:
        raise NotPollModuleError("errors.sessionZero.notPollModule")


def _text(raw: str, limit: int) -> str:
    text = raw.strip()
    if not text or len(text) > limit:
        raise InvalidPollsError("errors.sessionZero.pollText")
    return text


def _key(text: str) -> str:
    return " ".join(text.split()).casefold()


def clean_polls(specs: Sequence[PollSpec]) -> list[PollSpec]:
    """Decision 2: up to `MAX_POLLS` polls, each a question up to
    `MAX_POLL_LENGTH` with an optional hint, `MIN_OPTIONS` to `MAX_OPTIONS`
    distinct choices up to `MAX_OPTION_LENGTH`, and 1 to that many votes
    per person. Texts are trimmed, an empty hint is none."""
    if len(specs) > MAX_POLLS:
        raise InvalidPollsError("errors.sessionZero.tooManyPolls")
    cleaned: list[PollSpec] = []
    for spec in specs:
        if not MIN_OPTIONS <= len(spec.options) <= MAX_OPTIONS:
            raise InvalidPollsError("errors.sessionZero.pollOptions")
        options = tuple(
            OptionSpec(option.id, _text(option.body, MAX_OPTION_LENGTH)) for option in spec.options
        )
        if len({_key(option.body) for option in options}) != len(options):
            raise InvalidPollsError("errors.sessionZero.pollDuplicateOption")
        if not 1 <= spec.max_choices <= len(options):
            raise InvalidPollsError("errors.sessionZero.pollMaxChoices")
        hint = (spec.hint or "").strip() or None
        if hint is not None and len(hint) > MAX_HINT_LENGTH:
            raise InvalidPollsError("errors.sessionZero.pollText")
        cleaned.append(
            PollSpec(
                id=spec.id,
                body=_text(spec.body, MAX_POLL_LENGTH),
                hint=hint,
                max_choices=spec.max_choices,
                master_votes=spec.master_votes,
                voters_visible=spec.voters_visible,
                results=spec.results,
                options=options,
            )
        )
    return cleaned


def ensure_settings_kept(spec: PollSpec, poll: Poll, has_votes: bool) -> None:
    """Decision 3: once a poll has votes its settings stay, so nobody's
    vote becomes less secret than when it was cast."""
    if has_votes and not spec.same_settings(poll):
        raise PollSettingsLockedError("errors.sessionZero.pollSettingsLocked")


def is_voter(poll: Poll, role: RoomRole) -> bool:
    """The Players vote, and the Master when the poll says so (Q3)."""
    return role is RoomRole.PLAYER or (role is RoomRole.MASTER and poll.master_votes)


def ensure_can_vote(poll: Poll, role: RoomRole) -> None:
    """403 for someone who doesn't vote on it, 409 once it is closed."""
    if not is_voter(poll, role):
        raise NotAVoterError("errors.sessionZero.notAVoter")
    if poll.closed:
        raise PollClosedError("errors.sessionZero.pollClosed")


def clean_vote(
    poll: Poll, option_ids: Sequence[uuid.UUID], poll_option_ids: Collection[uuid.UUID]
) -> list[uuid.UUID]:
    """Decision 4: at most `max_choices` distinct choices of this poll;
    none withdraws the vote."""
    if len(set(option_ids)) != len(option_ids) or len(option_ids) > poll.max_choices:
        raise InvalidVoteError("errors.sessionZero.pollVote")
    if any(option_id not in poll_option_ids for option_id in option_ids):
        raise InvalidVoteError("errors.sessionZero.pollVote")
    return list(option_ids)


def sees_tally(poll: Poll, role: RoomRole) -> bool:
    """Decision 5: the Master always sees the tally; the others while it is
    live or once revealed."""
    return role is RoomRole.MASTER or poll.results is PollResults.LIVE or poll.revealed


def sees_names(poll: Poll, role: RoomRole) -> bool:
    """Decision 2 (Q4): who sees who voted what. Names follow the tally, so
    a secret poll's names stay hidden with it."""
    if poll.voters_visible is VotersVisible.NOBODY:
        return False
    if poll.voters_visible is VotersVisible.MASTER and role is not RoomRole.MASTER:
        return False
    return sees_tally(poll, role)


def winners(counts: dict[uuid.UUID, int]) -> set[uuid.UUID]:
    """Decision 6: the choices with the most votes; none before any vote."""
    best = max(counts.values(), default=0)
    return {option_id for option_id, count in counts.items() if best and count == best}

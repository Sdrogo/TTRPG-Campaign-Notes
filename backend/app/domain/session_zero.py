"""Session 0 boards (spec 46): a Room's Retro board, run in rounds, and its
Lines & Veils board. Who may see, write, publish, promote, move and react
to a post-it, the timer, and the limits. Pure: the repository reads and
writes the rows, the API turns these decisions into responses."""

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import RoomRole

# Decision 12.
MAX_BODY_LENGTH = 500
MAX_CARDS_PER_BOARD = 200
MAX_RETRO_COLUMNS = 8
MAX_COLUMN_TITLE_LENGTH = 60
MAX_ROUND_TITLE_LENGTH = 100
# Reactions per post-it, as on Comments (spec 19c Decision 1).
MAX_EMOJI_PER_CARD = 20
# Decision 4: a custom length up to an hour.
MIN_TIMER_SECONDS = 60
MAX_TIMER_SECONDS = 3600


class LinesVeilsKind(StrEnum):
    """The three fixed columns of the Lines & Veils board (Decision 10), in
    the order they are shown."""

    MUST = "must"
    LINES = "lines"
    VEILS = "veils"


class TimerAction(StrEnum):
    """What the Master does with the shared timer (Decision 4)."""

    START = "start"
    PAUSE = "pause"
    RESUME = "resume"
    STOP = "stop"


@dataclass(frozen=True)
class Round:
    """One round of the Retro board: "Sessione 0" first, then each Session
    0.5 (Decision 16). Only the open round (no `closed_at`) takes writes."""

    id: uuid.UUID
    room_id: uuid.UUID
    number: int
    title: str | None
    started_at: datetime
    closed_at: datetime | None


@dataclass(frozen=True)
class Column:
    """A column: a Retro one belongs to a round and has a title the Master
    sets; a Lines & Veils one has no round and a fixed `kind`."""

    id: uuid.UUID
    room_id: uuid.UUID
    round_id: uuid.UUID | None
    kind: LinesVeilsKind | None
    title: str
    position: int

    @property
    def is_retro(self) -> bool:
        """Whether the column is on the Retro board."""
        return self.round_id is not None


@dataclass(frozen=True)
class Card:
    """A post-it. A draft (no `published_at`) exists for its author only
    (Decision 1). A Lines & Veils copy has its Retro original in
    `source_card_id` (while it exists) and takes its author and anonymity
    (Decisions 2 and 7)."""

    id: uuid.UUID
    room_id: uuid.UUID
    column_id: uuid.UUID
    author_id: uuid.UUID
    body: str
    anonymous: bool
    published_at: datetime | None
    source_card_id: uuid.UUID | None
    promoted_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    @property
    def is_copy(self) -> bool:
        """Whether it was promoted into Lines & Veils (it keeps its
        promoter even once its original is gone)."""
        return self.promoted_by is not None

    @property
    def is_draft(self) -> bool:
        """Whether only its author sees it."""
        return self.published_at is None


@dataclass(frozen=True)
class Timer:
    """The Room's one shared timer (Decision 4). Running: `ends_at` is set.
    Paused: `paused_remaining_s` is set. Neither: stopped. `duration_s` is
    what it was started with, kept so a finished timer can show "time's
    up" until it is stopped."""

    duration_s: int | None
    ends_at: datetime | None
    paused_remaining_s: int | None


STOPPED_TIMER = Timer(duration_s=None, ends_at=None, paused_remaining_s=None)


class NotMasterError(DomainError):
    """Only the Master may do this (Decisions 4, 8, 10, 16)."""


class NotAuthorError(DomainError):
    """Only the post-it's author may do this (Decisions 1 and 9)."""


class RoundClosedError(DomainError):
    """A closed round is read-only (Decision 16)."""


class WrongBoardError(DomainError):
    """The column or post-it is on the wrong board for this action."""


class InvalidCardError(DomainError):
    """The post-it's text is empty or too long (Decision 12)."""


class InvalidTitleError(DomainError):
    """A column or round title is empty or too long."""


class AlreadyPublishedError(DomainError):
    """Publishing can't be undone or repeated (Decision 1)."""


class DraftCardError(DomainError):
    """A draft can't be promoted, reacted to or moderated: it isn't shared."""


class AlreadyPromotedError(DomainError):
    """The original already has a copy in that column (Decision 2)."""


class CopyNotEditableError(DomainError):
    """A Lines & Veils copy keeps its text; edit the original's wording by
    promoting again after deleting it (Decision 9)."""


class BoardFullError(DomainError):
    """The board already holds `MAX_CARDS_PER_BOARD` post-its (Decision 12)."""


class TooManyColumnsError(DomainError):
    """The Retro round already has `MAX_RETRO_COLUMNS` columns (Decision 12)."""


class InvalidTimerError(DomainError):
    """The timer can't do that now, or the length is out of range."""


class TooManyCardEmojiError(DomainError):
    """A post-it holds at most `MAX_EMOJI_PER_CARD` different emoji."""


def is_master(role: RoomRole) -> bool:
    """Whether the member runs the boards (the Master, D-08)."""
    return role is RoomRole.MASTER


def ensure_master(role: RoomRole) -> None:
    """403 for anyone but the Master."""
    if not is_master(role):
        raise NotMasterError("errors.sessionZero.notMaster")


def is_card_visible(card: Card, viewer_id: uuid.UUID) -> bool:
    """Decision 1: a published post-it is seen by every member, a draft by
    its author only - the Master included in the "only"."""
    return not card.is_draft or card.author_id == viewer_id


def shown_author(card: Card, viewer_id: uuid.UUID) -> uuid.UUID | None:
    """Decision 7: whom the post-it is shown as written by. An anonymous one
    shows its author to the author alone, never to anyone else."""
    if card.anonymous and card.author_id != viewer_id:
        return None
    return card.author_id


def clean_body(raw: str) -> str:
    """The post-it's text, trimmed: 1 to `MAX_BODY_LENGTH` characters, plain
    text (Decision 12)."""
    body = raw.strip()
    if not body or len(body) > MAX_BODY_LENGTH:
        raise InvalidCardError("errors.sessionZero.invalidBody", max=MAX_BODY_LENGTH)
    return body


def clean_column_title(raw: str) -> str:
    """A Retro column's title, trimmed: 1 to `MAX_COLUMN_TITLE_LENGTH`
    characters."""
    title = raw.strip()
    if not title or len(title) > MAX_COLUMN_TITLE_LENGTH:
        raise InvalidTitleError("errors.sessionZero.invalidTitle", max=MAX_COLUMN_TITLE_LENGTH)
    return title


def clean_round_title(raw: str | None) -> str | None:
    """A round's optional title (Decision 16), trimmed; blank is none."""
    title = (raw or "").strip()
    if len(title) > MAX_ROUND_TITLE_LENGTH:
        raise InvalidTitleError("errors.sessionZero.invalidTitle", max=MAX_ROUND_TITLE_LENGTH)
    return title or None


def ensure_round_open(round_: Round | None) -> None:
    """409 when a Retro write targets a closed round. `None` stands for the
    Lines & Veils board, which has no rounds and is always open."""
    if round_ is not None and round_.closed_at is not None:
        raise RoundClosedError("errors.sessionZero.roundClosed")


def ensure_can_add_card(column: Column, round_: Round | None, cards_on_board: int) -> None:
    """Decision 1: any member writes post-its, on the open round's Retro
    columns only - the Lines & Veils board is filled by promotion
    (Decision 2). At most `MAX_CARDS_PER_BOARD` per board, counted as the
    writer sees it (published post-its plus their own drafts), so the limit
    never tells them someone else holds drafts."""
    if not column.is_retro:
        raise WrongBoardError("errors.sessionZero.notRetroColumn")
    ensure_round_open(round_)
    if cards_on_board >= MAX_CARDS_PER_BOARD:
        raise BoardFullError("errors.sessionZero.boardFull", max=MAX_CARDS_PER_BOARD)


def ensure_can_edit_card(card: Card, round_: Round | None, editor_id: uuid.UUID) -> None:
    """Decision 9: the author edits their own Retro post-it, draft or
    published, while its round is open. A Lines & Veils copy keeps the text
    it was promoted with."""
    if card.is_copy:
        raise CopyNotEditableError("errors.sessionZero.copyNotEditable")
    if card.author_id != editor_id:
        raise NotAuthorError("errors.sessionZero.notAuthor")
    ensure_round_open(round_)


def can_delete_card(card: Card, round_: Round | None, viewer_id: uuid.UUID, role: RoomRole) -> bool:
    """Decision 9: the author deletes their own post-it and the Master any
    published one; a Lines & Veils copy goes with the Master or its
    original's author (Decision 8). Not in a closed round (Decision 16)."""
    if round_ is not None and round_.closed_at is not None:
        return False
    if card.author_id == viewer_id:
        return True
    return is_master(role) and not card.is_draft


def ensure_can_delete_card(
    card: Card, round_: Round | None, viewer_id: uuid.UUID, role: RoomRole
) -> None:
    """Raises why `can_delete_card` says no."""
    ensure_round_open(round_)
    if not can_delete_card(card, round_, viewer_id, role):
        raise NotAuthorError("errors.sessionZero.notAuthor")


def ensure_can_publish(
    card: Card, round_: Round | None, publisher_id: uuid.UUID, published_on_board: int
) -> None:
    """Decision 1: only the author publishes, once, while the round is open
    and the board has fewer than `MAX_CARDS_PER_BOARD` published post-its."""
    if card.author_id != publisher_id:
        raise NotAuthorError("errors.sessionZero.notAuthor")
    ensure_round_open(round_)
    if not card.is_draft:
        raise AlreadyPublishedError("errors.sessionZero.alreadyPublished")
    if published_on_board >= MAX_CARDS_PER_BOARD:
        raise BoardFullError("errors.sessionZero.boardFull", max=MAX_CARDS_PER_BOARD)


def can_promote(card: Card, source_column: Column, role: RoomRole) -> bool:
    """Decisions 2, 8 and 16: the Master promotes any published Retro
    post-it, of any round; Players never do, not even their own."""
    return is_master(role) and source_column.is_retro and not card.is_draft


def ensure_can_promote(
    card: Card,
    source_column: Column,
    target: Column,
    role: RoomRole,
    copied_to: Collection[uuid.UUID],
    cards_on_board: int,
) -> None:
    """Raises unless the Master may copy `card` into `target`, a Lines &
    Veils column without a copy of it yet (`copied_to` holds the columns
    that already have one; Decision 2), on a board with room left."""
    ensure_master(role)
    if card.is_draft:
        raise DraftCardError("errors.sessionZero.draft")
    if not source_column.is_retro or target.is_retro:
        raise WrongBoardError("errors.sessionZero.promoteRetroToLinesVeils")
    if target.id in copied_to:
        raise AlreadyPromotedError("errors.sessionZero.alreadyPromoted")
    if cards_on_board >= MAX_CARDS_PER_BOARD:
        raise BoardFullError("errors.sessionZero.boardFull", max=MAX_CARDS_PER_BOARD)


def ensure_can_move(
    card: Card,
    source_column: Column,
    target: Column,
    role: RoomRole,
    siblings_in_target: Collection[uuid.UUID],
) -> None:
    """Decision 16: the Master moves a Lines & Veils post-it to another of
    its columns (a Line becomes a Veil). 409 when a copy of the same
    original is already there: `siblings_in_target` holds the originals of
    the copies in `target`. Moving to its own column changes nothing."""
    ensure_master(role)
    if source_column.is_retro or target.is_retro:
        raise WrongBoardError("errors.sessionZero.notLinesVeils")
    if (
        target.id != source_column.id
        and card.source_card_id is not None
        and card.source_card_id in siblings_in_target
    ):
        raise AlreadyPromotedError("errors.sessionZero.alreadyPromoted")


def ensure_can_react(
    card: Card, round_: Round | None, emoji: str, emoji_on_card: Collection[str]
) -> None:
    """Decision 5: any member reacts to a published post-it, at most
    `MAX_EMOJI_PER_CARD` different emoji on one; a closed round takes none."""
    if card.is_draft:
        raise DraftCardError("errors.sessionZero.draft")
    ensure_round_open(round_)
    distinct = set(emoji_on_card)
    if emoji not in distinct and len(distinct) >= MAX_EMOJI_PER_CARD:
        raise TooManyCardEmojiError("errors.sessionZero.tooManyEmoji", max=MAX_EMOJI_PER_CARD)


def ensure_can_add_column(round_: Round, retro_columns: int) -> None:
    """Decision 10: the Master adds Retro columns to the open round, at most
    `MAX_RETRO_COLUMNS` (the caller has checked the role)."""
    ensure_round_open(round_)
    if retro_columns >= MAX_RETRO_COLUMNS:
        raise TooManyColumnsError("errors.sessionZero.tooManyColumns", max=MAX_RETRO_COLUMNS)


def ensure_retro_column(column: Column, round_: Round | None) -> None:
    """Lines & Veils columns are fixed (Decision 10); a closed round's are
    read-only (Decision 16)."""
    if not column.is_retro:
        raise WrongBoardError("errors.sessionZero.notRetroColumn")
    ensure_round_open(round_)


def remaining_seconds(timer: Timer, now: datetime) -> int | None:
    """Seconds left on the timer: counting down, paused, 0 once it is over
    (it never goes negative), or `None` when stopped."""
    if timer.ends_at is not None:
        return max(0, int((timer.ends_at - now).total_seconds() + 0.999))
    return timer.paused_remaining_s


def apply_timer(timer: Timer, action: TimerAction, duration_s: int | None, now: datetime) -> Timer:
    """Decision 4: start (a length from `MIN_TIMER_SECONDS` to
    `MAX_TIMER_SECONDS`, restarting a running one), pause a running one,
    resume a paused one, stop it whatever its state. Never blocks writing."""
    if action is TimerAction.START:
        if duration_s is None or not MIN_TIMER_SECONDS <= duration_s <= MAX_TIMER_SECONDS:
            raise InvalidTimerError(
                "errors.sessionZero.timerLength", min=MIN_TIMER_SECONDS, max=MAX_TIMER_SECONDS
            )
        return Timer(duration_s, now + timedelta(seconds=duration_s), None)
    if action is TimerAction.PAUSE:
        if timer.ends_at is None or timer.ends_at <= now:
            raise InvalidTimerError("errors.sessionZero.timerNotRunning")
        return Timer(timer.duration_s, None, remaining_seconds(timer, now))
    if action is TimerAction.RESUME:
        if timer.paused_remaining_s is None:
            raise InvalidTimerError("errors.sessionZero.timerNotPaused")
        return Timer(timer.duration_s, now + timedelta(seconds=timer.paused_remaining_s), None)
    return STOPPED_TIMER

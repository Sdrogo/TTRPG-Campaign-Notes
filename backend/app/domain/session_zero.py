"""Session 0 boards (spec 46): a Room's sessions (rounds), each a chain of
modules the Master walks the table through (spec 47), and its Room-wide
Lines & Veils board. Who may see, write, publish, promote, move and react
to a post-it, the chain, the timer, and the limits. Pure: the repository reads and
writes the rows, the API turns these decisions into responses."""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.relationship_maps import MapColor

# Decision 12.
MAX_BODY_LENGTH = 500
MAX_CARDS_PER_BOARD = 200
MAX_RETRO_COLUMNS = 8
MAX_COLUMN_TITLE_LENGTH = 60
MAX_ROUND_TITLE_LENGTH = 100
MAX_GROUP_TITLE_LENGTH = 60
# Reactions per post-it, as on Comments (spec 19c Decision 1).
MAX_EMOJI_PER_CARD = 20
# Spec 47 Decision 1.
MAX_MODULES = 10
# Decision 4: a custom length up to an hour.
MIN_TIMER_SECONDS = 60
MAX_TIMER_SECONDS = 3600


class LinesVeilsKind(StrEnum):
    """The three fixed columns of the Lines & Veils board (Decision 10), in
    the order they are shown: from what the group wants to the hardest
    limit, like a traffic light (spec 46c Decision 5)."""

    MUST = "must"
    VEILS = "veils"
    LINES = "lines"


# Spec 46c Decision 5: the traffic light, from the maps' palette.
LINES_VEILS_COLORS: dict[LinesVeilsKind, MapColor] = {
    LinesVeilsKind.MUST: MapColor.GREEN,
    LinesVeilsKind.VEILS: MapColor.GOLD,
    LinesVeilsKind.LINES: MapColor.RED,
}


class StarsWishesKind(StrEnum):
    """The two fixed columns of a Stars and Wishes module (spec 47
    Decision 7)."""

    STARS = "stars"
    WISHES = "wishes"


STARS_WISHES_COLORS: dict[StarsWishesKind, MapColor] = {
    StarsWishesKind.STARS: MapColor.GOLD,
    StarsWishesKind.WISHES: MapColor.BLUE,
}

ColumnKind = LinesVeilsKind | StarsWishesKind


def column_kind(raw: str) -> ColumnKind:
    """A stored column `kind`, as its enum."""
    if raw in StarsWishesKind:
        return StarsWishesKind(raw)
    return LinesVeilsKind(raw)


class ModuleKind(StrEnum):
    """What a step of a session's chain is (spec 47 Decision 1)."""

    RETRO = "retro"
    LINES_VEILS = "lines_veils"
    STARS_WISHES = "stars_wishes"
    QUESTIONS = "questions"
    DDI = "ddi"


# Spec 47 Decision 2: a chain nobody composed, as the page was before.
DEFAULT_CHAIN = (ModuleKind.RETRO, ModuleKind.LINES_VEILS)


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
    # Spec 47 Decision 4: the step the table is on.
    current_module_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Module:
    """A step of a round's chain (spec 47 Decision 1), at `position`. A
    Questions module's settings (spec 47 Decisions 9-11): the Tag of its
    Documents, whether every member reads the answers, whether Players
    create their Documents even where the Room doesn't let them (Q7). A
    DDI module's Document (spec 47 Decision 8)."""

    id: uuid.UUID
    round_id: uuid.UUID
    kind: ModuleKind
    position: int
    tag_id: uuid.UUID | None = None
    answers_revealed: bool = False
    players_bypass_creation_rule: bool = True
    document_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Column:
    """A column of a round's post-it board: a Retro one, titled by the
    Master, or a fixed Stars and Wishes one (a `kind`; spec 47 Decision 7),
    in its module. Or a Lines & Veils one: no round, no module, a fixed
    `kind`."""

    id: uuid.UUID
    room_id: uuid.UUID
    round_id: uuid.UUID | None
    kind: ColumnKind | None
    title: str
    position: int
    color: MapColor = MapColor.DEFAULT
    module_id: uuid.UUID | None = None

    @property
    def is_retro(self) -> bool:
        """Whether the column is on a round's post-it board (a Retro or a
        Stars and Wishes module) rather than on Lines & Veils."""
        return self.round_id is not None

    @property
    def is_promotable(self) -> bool:
        """Whether its post-its can be promoted to Lines & Veils: a Retro
        column's only (spec 47 Decision 7)."""
        return self.is_retro and self.kind is None

    @property
    def shown_color(self) -> MapColor:
        """Its colour: a Retro column's own, a fixed one's from its kind
        (spec 46c Decision 5, spec 47 Decision 7)."""
        if isinstance(self.kind, StarsWishesKind):
            return STARS_WISHES_COLORS[self.kind]
        return LINES_VEILS_COLORS[self.kind] if self.kind else self.color


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
    group_id: uuid.UUID | None = None
    # Spec 46d Decision 7: its place in its group, or among its column's
    # post-its in no group and its groups.
    position: int = 0

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
class Group:
    """Related post-its of one Retro column (spec 46c Decision 9), gathered
    by the Master, or by a Player from their own (spec 46d Q2). `position`
    is its place among its column's post-its in no group."""

    id: uuid.UUID
    column_id: uuid.UUID
    title: str | None
    position: int = 0


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


class InvalidChainError(DomainError):
    """A chain holds 1 to `MAX_MODULES` modules (spec 47 Decision 1)."""


class LastModuleError(DomainError):
    """A session keeps at least one module (spec 47 Decision 3)."""


class TooManyColumnsError(DomainError):
    """The Retro round already has `MAX_RETRO_COLUMNS` columns (Decision 12)."""


class InvalidTimerError(DomainError):
    """The timer can't do that now, or the length is out of range."""


class TooManyCardEmojiError(DomainError):
    """A post-it holds at most `MAX_EMOJI_PER_CARD` different emoji."""


class NotGroupableError(DomainError):
    """Only two or more published post-its of one Retro column group (spec
    46c Decision 9)."""


class BadPlaceError(DomainError):
    """The post-it or group to drop before isn't in the column or group it
    is dropped into (spec 46d Decision 7)."""


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


def clean_group_title(raw: str | None) -> str | None:
    """A group's optional title (spec 46c Decision 9), trimmed; blank is none."""
    title = (raw or "").strip()
    if len(title) > MAX_GROUP_TITLE_LENGTH:
        raise InvalidTitleError("errors.sessionZero.invalidTitle", max=MAX_GROUP_TITLE_LENGTH)
    return title or None


def ensure_round_open(round_: Round | None) -> None:
    """409 when a Retro write targets a closed round. `None` stands for the
    Lines & Veils board, which has no rounds and is always open."""
    if round_ is not None and round_.closed_at is not None:
        raise RoundClosedError("errors.sessionZero.roundClosed")


def ensure_can_add_card(
    column: Column, round_: Round | None, cards_on_board: int, role: RoomRole
) -> None:
    """Decision 1: any member writes post-its on the open round's Retro
    columns. On Lines & Veils only the Master writes directly (spec 46c
    Decision 6); everyone else's limits come by promotion (Decision 2). At
    most `MAX_CARDS_PER_BOARD` per board, counted as the writer sees it
    (published post-its plus their own drafts), so the limit never tells
    them someone else holds drafts."""
    if not column.is_retro:
        ensure_master(role)
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


def publishable_count(drafts: int, published_on_board: int) -> int:
    """Spec 46c Decision 8: how many of the caller's `drafts` "publish all"
    publishes, as many as the board has room for; 409 when it has none."""
    room_left = MAX_CARDS_PER_BOARD - published_on_board
    if room_left <= 0:
        raise BoardFullError("errors.sessionZero.boardFull", max=MAX_CARDS_PER_BOARD)
    return min(drafts, room_left)


def can_promote(card: Card, source_column: Column, role: RoomRole) -> bool:
    """Decisions 2, 8 and 16: the Master promotes any published Retro
    post-it, of any round; Players never do, not even their own."""
    return is_master(role) and source_column.is_promotable and not card.is_draft


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
    if not source_column.is_promotable or target.is_retro:
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


def can_group(
    card: Card, column: Column, round_: Round | None, viewer_id: uuid.UUID, role: RoomRole
) -> bool:
    """Spec 46c Decision 9: the Master groups published post-its of a Retro
    column of the open round; a Player groups their own (spec 46d Q2)."""
    return (
        (is_master(role) or card.author_id == viewer_id)
        and column.is_retro
        and not card.is_draft
        and round_ is not None
        and round_.closed_at is None
    )


def ensure_can_group(
    cards: Collection[Card],
    column: Column,
    round_: Round | None,
    viewer_id: uuid.UUID,
    role: RoomRole,
    mates: Collection[Card] = (),
) -> None:
    """Raises unless the caller may group `cards`: at least two, every one
    published and in `column`, a Retro column of the open round. The Master
    groups any; a Player only their own, and only into groups (`mates`, the
    post-its already in the groups `cards` bring along) that hold nobody
    else's (spec 46d Q2)."""
    if not is_master(role) and any(card.author_id != viewer_id for card in [*cards, *mates]):
        raise NotAuthorError("errors.sessionZero.notAuthor")
    ensure_round_open(round_)
    if (
        len(cards) < 2
        or not column.is_retro
        or any(card.is_draft or card.column_id != column.id for card in cards)
    ):
        raise NotGroupableError("errors.sessionZero.notGroupable")


def can_place(
    card: Card, column: Column, round_: Round | None, viewer_id: uuid.UUID, role: RoomRole
) -> bool:
    """Spec 46d Decision 7: who drags a post-it. On the open round's Retro
    board the Master drags any, a Player their own (Q2); on Lines & Veils
    the Master (Decision 16)."""
    if not column.is_retro:
        return is_master(role)
    open_ = round_ is not None and round_.closed_at is None
    return open_ and (is_master(role) or card.author_id == viewer_id)


def ensure_can_place_card(
    card: Card,
    source: Column,
    target: Column,
    round_: Round | None,
    viewer_id: uuid.UUID,
    role: RoomRole,
    *,
    into_group: bool,
    mates: Collection[Card] = (),
    sources_in_target: Collection[uuid.UUID] = (),
) -> None:
    """Spec 46d Decision 7: raises unless the caller may drop `card` into
    `target` (into a group of it when `into_group`). It stays on its board
    and, on the Retro board, in its round, which must be open. On the Retro
    board the Master moves any post-it, a Player their own, drafts included;
    one leaving or joining a group takes a Player's only when every other
    post-it of that group (`mates`) is theirs too (Q2), and a draft joins
    none. Lines & Veils is the Master's (`ensure_can_move`)."""
    if source.is_retro != target.is_retro or source.module_id != target.module_id:
        raise WrongBoardError("errors.sessionZero.sameBoard")
    if not target.is_retro:
        ensure_can_move(card, source, target, role, sources_in_target)
        return
    ensure_round_open(round_)
    if not is_master(role) and any(other.author_id != viewer_id for other in [card, *mates]):
        raise NotAuthorError("errors.sessionZero.notAuthor")
    if into_group and card.is_draft:
        raise NotGroupableError("errors.sessionZero.notGroupable")


def ensure_can_place_group(
    source: Column, target: Column, round_: Round | None, role: RoomRole
) -> None:
    """Spec 46d Decision 7: the Master drags a group, as one block, within
    its column or into another column of the same module of the open round."""
    ensure_master(role)
    if not target.is_retro or source.module_id != target.module_id:
        raise WrongBoardError("errors.sessionZero.sameBoard")
    ensure_round_open(round_)


def placed(
    order: Sequence[uuid.UUID],
    item: uuid.UUID,
    before: uuid.UUID | None,
    hidden: Collection[uuid.UUID] = (),
) -> list[uuid.UUID]:
    """`order` with `item` put just before `before`, or last when `None`,
    taken out of where it was. 422 when `before` isn't in `order` (or is
    `item` itself), or is in `hidden`: someone else's draft, answered like
    a missing id so its existence never leaks (Decision 1)."""
    rest = [other for other in order if other != item]
    if before is None:
        return [*rest, item]
    if before not in rest or before in hidden:
        raise BadPlaceError("errors.sessionZero.badPlace")
    index = rest.index(before)
    return [*rest[:index], item, *rest[index:]]


def ensure_can_add_column(round_: Round, retro_columns: int) -> None:
    """Decision 10: the Master adds Retro columns to the open round, at most
    `MAX_RETRO_COLUMNS` (the caller has checked the role)."""
    ensure_round_open(round_)
    if retro_columns >= MAX_RETRO_COLUMNS:
        raise TooManyColumnsError("errors.sessionZero.tooManyColumns", max=MAX_RETRO_COLUMNS)


def ensure_retro_column(column: Column, round_: Round | None) -> None:
    """Lines & Veils columns are fixed (Decision 10), and so are Stars and
    Wishes ones (spec 47 Decision 7); a closed round's are read-only
    (Decision 16)."""
    if not column.is_promotable:
        raise WrongBoardError("errors.sessionZero.notRetroColumn")
    ensure_round_open(round_)


def clean_chain(kinds: Sequence[ModuleKind]) -> list[ModuleKind]:
    """Spec 47 Decision 1: a chain of 1 to `MAX_MODULES` modules, any kind
    any number of times."""
    if not 1 <= len(kinds) <= MAX_MODULES:
        raise InvalidChainError("errors.sessionZero.invalidChain", max=MAX_MODULES)
    return list(kinds)


CARRYABLE_KINDS = frozenset({ModuleKind.RETRO, ModuleKind.QUESTIONS, ModuleKind.DDI})


def carry_source(
    earlier: Sequence[Sequence[Module]], kind: ModuleKind, index: int
) -> Module | None:
    """Spec 47b Decision 4: the step a new `index`-th step of `kind` carries
    over from. `earlier` holds the earlier sessions' chains, newest first;
    the newest with a step of that kind gives its `index`-th one, or its
    last when it has fewer. None when no earlier session has one."""
    if kind not in CARRYABLE_KINDS:
        return None
    for chain in earlier:
        same = [module for module in chain if module.kind is kind]
        if same:
            return same[min(index, len(same) - 1)]
    return None


def ensure_can_add_module(round_: Round, modules: int) -> None:
    """Spec 47 Decision 3: the Master adds a module to the open round's
    chain, at most `MAX_MODULES` (the caller has checked the role)."""
    ensure_round_open(round_)
    if modules >= MAX_MODULES:
        raise InvalidChainError("errors.sessionZero.invalidChain", max=MAX_MODULES)


def ensure_can_remove_module(round_: Round, modules: int) -> None:
    """Spec 47 Decision 3: the open round's chain keeps at least one module."""
    ensure_round_open(round_)
    if modules <= 1:
        raise LastModuleError("errors.sessionZero.lastModule")


def current_after_removal(
    chain: Sequence[Module], removed: uuid.UUID, current: uuid.UUID | None
) -> uuid.UUID | None:
    """The step the table is on once `removed` leaves the chain: unchanged,
    or, when it was the current one, the step before it (the next one when
    it was first)."""
    if current != removed:
        return current
    ids = [module.id for module in chain]
    index = ids.index(removed)
    rest = ids[:index] + ids[index + 1 :]
    return rest[max(index - 1, 0)] if rest else None


def visible_modules(
    chain: Sequence[Module], current: uuid.UUID | None, role: RoomRole
) -> list[Module]:
    """Spec 47 Decision 5: the Master sees every step, to prepare the later
    ones; a Player the steps already reached, the current one included."""
    if is_master(role):
        return list(chain)
    positions = [module.position for module in chain if module.id == current]
    if not positions:
        return []
    return [module for module in chain if module.position <= positions[0]]


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

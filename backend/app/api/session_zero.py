"""Session 0 boards (spec 46): a Room's Retro board, run in rounds, and its
Lines & Veils board. Every member reads and writes; drafts stay with their
authors (Decision 1). Every write answers with the open round's boards as
the caller sees them, and every write the other members see bumps the
Session 0's `revision` (Decision 3, for the live updates)."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.auth.dependencies import VIEW_AS_HEADER, CurrentUserDep
from app.db import session_zero_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import Membership
from app.domain.reactions import InvalidEmojiError, parse_emoji, summarize_reactions
from app.domain.session_zero import (
    AlreadyPromotedError,
    AlreadyPublishedError,
    BoardFullError,
    Card,
    Column,
    CopyNotEditableError,
    DraftCardError,
    InvalidCardError,
    InvalidTimerError,
    InvalidTitleError,
    NotAuthorError,
    NotMasterError,
    Round,
    RoundClosedError,
    Timer,
    TimerAction,
    TooManyCardEmojiError,
    TooManyColumnsError,
    WrongBoardError,
    apply_timer,
    can_delete_card,
    can_promote,
    clean_body,
    clean_column_title,
    clean_round_title,
    ensure_can_add_card,
    ensure_can_add_column,
    ensure_can_delete_card,
    ensure_can_edit_card,
    ensure_can_move,
    ensure_can_promote,
    ensure_can_publish,
    ensure_can_react,
    ensure_master,
    ensure_retro_column,
    ensure_round_open,
    is_card_visible,
    is_master,
    remaining_seconds,
    shown_author,
)
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate

router = APIRouter(prefix="/rooms/{room_id}/session-zero", tags=["session-zero"])

# Decision 10: the Retro board's first columns, named in the language of
# whoever starts the Session 0.
PRESET_COLUMN_KEYS = (
    "sessionZero.presets.want",
    "sessionZero.presets.care",
    "sessionZero.presets.avoid",
    "sessionZero.presets.questions",
)

_STATUS_FOR: dict[type[DomainError], int] = {
    NotMasterError: status.HTTP_403_FORBIDDEN,
    NotAuthorError: status.HTTP_403_FORBIDDEN,
    InvalidCardError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidTitleError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidTimerError: status.HTTP_409_CONFLICT,
    WrongBoardError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    RoundClosedError: status.HTTP_409_CONFLICT,
    AlreadyPublishedError: status.HTTP_409_CONFLICT,
    AlreadyPromotedError: status.HTTP_409_CONFLICT,
    DraftCardError: status.HTTP_409_CONFLICT,
    CopyNotEditableError: status.HTTP_409_CONFLICT,
    BoardFullError: status.HTTP_409_CONFLICT,
    TooManyColumnsError: status.HTTP_409_CONFLICT,
    TooManyCardEmojiError: status.HTTP_409_CONFLICT,
}


def _domain_error(exc: DomainError, locale: str) -> HTTPException:
    """The status each Session 0 rule maps to (403 rights, 422 input, 409
    state)."""
    return translated_error(_STATUS_FOR[type(exc)], exc, locale)


class ReactionResponse(BaseModel):
    """One emoji on a post-it, as on Comments (spec 19c)."""

    emoji: str
    count: int
    reacted_by_me: bool
    user_ids: list[uuid.UUID]


class CardResponse(BaseModel):
    """A post-it as the caller sees it. `author_id` is empty on someone
    else's anonymous post-it (Decision 7); `from_retro` marks a Lines &
    Veils copy (Decision 2). The `can_*` flags drive the menu."""

    id: uuid.UUID
    column_id: uuid.UUID
    body: str
    author_id: uuid.UUID | None
    anonymous: bool
    mine: bool
    draft: bool
    from_retro: bool
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    reactions: list[ReactionResponse]
    can_edit: bool
    can_delete: bool
    can_publish: bool
    can_promote: bool
    can_move: bool
    can_react: bool


class ColumnResponse(BaseModel):
    """A column and its post-its, oldest first. `kind` is set on the Lines &
    Veils columns (`must`, `lines`, `veils`), whose title the client names."""

    id: uuid.UUID
    kind: str | None
    title: str
    cards: list[CardResponse]


class RoundResponse(BaseModel):
    """A round of the Retro board (Decision 16)."""

    id: uuid.UUID
    number: int
    title: str | None
    started_at: datetime
    closed_at: datetime | None


class TimerResponse(BaseModel):
    """The shared timer (Decision 4): `running` with `ends_at`, `paused`
    with `remaining_s`, or `stopped`. `remaining_s` is computed at `now`, the
    server's clock, so a client can correct its own."""

    state: str
    duration_s: int | None
    ends_at: datetime | None
    remaining_s: int | None
    now: datetime


class SessionZeroResponse(BaseModel):
    """The Session 0 page. Before anyone starts it, `started` is false and
    the rest is empty. `round_id` is the round shown on the Retro board."""

    started: bool
    revision: int
    can_manage: bool
    rounds: list[RoundResponse]
    round_id: uuid.UUID | None
    retro: list[ColumnResponse]
    lines_veils: list[ColumnResponse]
    timer: TimerResponse | None


class NewCardBody(BaseModel):
    """A new post-it in a Retro column."""

    column_id: uuid.UUID
    body: str


class CardBody(BaseModel):
    """A post-it's new text."""

    body: str


class PublishBody(BaseModel):
    """Decision 7: signed (the default) or anonymous."""

    anonymous: bool = False


class TargetColumnBody(BaseModel):
    """The column a post-it is promoted or moved to."""

    column_id: uuid.UUID


class ColumnBody(BaseModel):
    """A Retro column's title."""

    title: str


class ColumnOrderBody(BaseModel):
    """The open round's Retro columns, every one, in their new order."""

    column_ids: list[uuid.UUID]


class RoundBody(BaseModel):
    """A new round's optional title (Decision 16)."""

    title: str | None = None


class TimerBody(BaseModel):
    """What to do with the timer; `duration_s` only to start it."""

    action: TimerAction
    duration_s: int | None = None


@dataclass(frozen=True)
class _Board:
    """The Room's Session 0 as stored: rounds, columns and where each lives."""

    rounds: list[Round]
    columns: dict[uuid.UUID, Column]

    @property
    def open_round(self) -> Round:
        """The round that takes writes; there is always exactly one."""
        return next(round_ for round_ in self.rounds if round_.closed_at is None)

    def round_of(self, column: Column) -> Round | None:
        """The column's round, or `None` on the Lines & Veils board."""
        return next((r for r in self.rounds if r.id == column.round_id), None)

    def retro_columns(self, round_id: uuid.UUID) -> list[Column]:
        """A round's Retro columns, in order."""
        return [c for c in self.columns.values() if c.round_id == round_id]

    def lines_veils_columns(self) -> list[Column]:
        """The three Lines & Veils columns, in order."""
        return [c for c in self.columns.values() if not c.is_retro]


async def _load_board(session: AsyncSession, room_id: uuid.UUID) -> _Board:
    rounds = await session_zero_repo.list_rounds(session, room_id)
    columns = await session_zero_repo.list_columns(session, room_id)
    return _Board(rounds=rounds, columns={column.id: column for column in columns})


def _timer_response(timer: Timer, now: datetime) -> TimerResponse:
    if timer.ends_at is not None:
        state = "running"
    elif timer.paused_remaining_s is not None:
        state = "paused"
    else:
        state = "stopped"
    return TimerResponse(
        state=state,
        duration_s=timer.duration_s,
        ends_at=timer.ends_at,
        remaining_s=remaining_seconds(timer, now),
        now=now,
    )


async def _board_response(
    session: AsyncSession,
    room_id: uuid.UUID,
    viewer: Membership,
    round_id: uuid.UUID | None,
    locale: str,
    *,
    previewed: bool = False,
) -> SessionZeroResponse:
    """The boards as `viewer` sees them, with the Retro board of `round_id`
    (the open round when `None`; 404 for a round of another Room). A
    `previewed` viewer is the Master's "View as": their drafts stay hidden,
    since a draft is its author's alone (Decision 1)."""
    now = datetime.now(UTC)
    state = await session_zero_repo.get_state(session, room_id)
    if state is None:
        return SessionZeroResponse(
            started=False,
            revision=0,
            can_manage=is_master(viewer.role),
            rounds=[],
            round_id=None,
            retro=[],
            lines_veils=[],
            timer=None,
        )
    revision, timer = state
    board = await _load_board(session, room_id)
    if round_id is None:
        shown = board.open_round
    else:
        found = next((r for r in board.rounds if r.id == round_id), None)
        if found is None:
            raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.roundNotFound", locale)
        shown = found
    retro = board.retro_columns(shown.id)
    lines_veils = board.lines_veils_columns()
    cards = [
        card
        for card in await session_zero_repo.list_cards(
            session, [column.id for column in retro + lines_veils]
        )
        if is_card_visible(card, viewer.user_id) and not (previewed and card.is_draft)
    ]
    reactions = await session_zero_repo.list_reactions(
        session, [card.id for card in cards if not card.is_draft]
    )

    def card_response(card: Card) -> CardResponse:
        column = board.columns[card.column_id]
        round_ = board.round_of(column)
        open_ = round_ is None or round_.closed_at is None
        mine = card.author_id == viewer.user_id
        return CardResponse(
            id=card.id,
            column_id=card.column_id,
            body=card.body,
            author_id=shown_author(card, viewer.user_id),
            anonymous=card.anonymous,
            mine=mine,
            draft=card.is_draft,
            from_retro=card.is_copy,
            published_at=card.published_at,
            created_at=card.created_at,
            updated_at=card.updated_at,
            reactions=[
                ReactionResponse(
                    emoji=summary.emoji,
                    count=summary.count,
                    reacted_by_me=summary.reacted_by_me,
                    user_ids=summary.user_ids,
                )
                for summary in summarize_reactions(reactions[card.id], viewer.user_id)
            ],
            can_edit=mine and open_ and not card.is_copy,
            can_delete=can_delete_card(card, round_, viewer.user_id, viewer.role),
            can_publish=mine and open_ and card.is_draft,
            can_promote=can_promote(card, column, viewer.role),
            can_move=is_master(viewer.role) and not column.is_retro,
            can_react=open_ and not card.is_draft,
        )

    def column_response(column: Column) -> ColumnResponse:
        return ColumnResponse(
            id=column.id,
            kind=column.kind.value if column.kind else None,
            title=column.title,
            cards=[card_response(card) for card in cards if card.column_id == column.id],
        )

    return SessionZeroResponse(
        started=True,
        revision=revision,
        can_manage=is_master(viewer.role),
        rounds=[
            RoundResponse(
                id=r.id,
                number=r.number,
                title=r.title,
                started_at=r.started_at,
                closed_at=r.closed_at,
            )
            for r in board.rounds
        ],
        round_id=shown.id,
        retro=[column_response(column) for column in retro],
        lines_veils=[column_response(column) for column in lines_veils],
        timer=_timer_response(timer, now),
    )


@dataclass(frozen=True)
class _Write:
    """What every write starts from: the caller's Membership, the board,
    under the Session 0's row lock."""

    viewer: Membership
    board: _Board


async def _begin_write(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> _Write:
    """Checks membership, then takes the Session 0's row lock (409 before it
    is started), so the Room's board writes happen one at a time."""
    viewer = await require_membership(session, room_id, user_id, locale)
    if await session_zero_repo.get_state(session, room_id, lock=True) is None:
        raise http_error(status.HTTP_409_CONFLICT, "errors.sessionZero.notStarted", locale)
    return _Write(viewer=viewer, board=await _load_board(session, room_id))


def _column_or_404(write: _Write, column_id: uuid.UUID, locale: str) -> Column:
    column = write.board.columns.get(column_id)
    if column is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.columnNotFound", locale)
    return column


async def _card_or_404(
    session: AsyncSession, write: _Write, card_id: uuid.UUID, locale: str
) -> tuple[Card, Column]:
    """The post-it and its column, or 404 - also for someone else's draft,
    so its existence never leaks (Decision 1)."""
    card = await session_zero_repo.get_card(session, card_id)
    if (
        card is None
        or card.room_id != write.viewer.room_id
        or not is_card_visible(card, write.viewer.user_id)
    ):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.cardNotFound", locale)
    return card, write.board.columns[card.column_id]


async def _shared(session: AsyncSession, room_id: uuid.UUID) -> None:
    """Marks a write every member sees (Decision 3); a draft's never is."""
    await session_zero_repo.bump_revision(session, room_id)


async def _answer(
    session: AsyncSession, room_id: uuid.UUID, write: _Write, locale: str
) -> SessionZeroResponse:
    return await _board_response(session, room_id, write.viewer, None, locale)


def _parse_emoji(emoji: str, locale: str) -> str:
    try:
        return parse_emoji(emoji)
    except InvalidEmojiError as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc


@router.get("")
async def get_session_zero(
    request: Request,
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    round_id: uuid.UUID | None = None,
) -> SessionZeroResponse:
    """The Session 0 page as the caller sees it: their own drafts and every
    published post-it, the Retro board of `round_id` (the open round by
    default) and the Lines & Veils board. Never writes (a "View as" preview
    reads it too, without the member's drafts); a member starts the
    Session 0 with `POST .../start`."""
    viewer = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    previewed = VIEW_AS_HEADER in request.headers
    return await _board_response(session, room_id, viewer, round_id, locale, previewed=previewed)


@router.post("/start")
async def start_session_zero(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> SessionZeroResponse:
    """Decision 10: the first member to open the page starts the Room's
    Session 0 - round 1 with the four preset Retro columns, named in their
    language, and the Must / Lines / Veils columns. Idempotent."""
    viewer = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    titles = [translate(key, locale) for key in PRESET_COLUMN_KEYS]
    if await session_zero_repo.start(session, room_id, titles, datetime.now(UTC)):
        await _shared(session, room_id)
    return await _board_response(session, room_id, viewer, None, locale)


@router.post("/cards")
async def add_card(
    room_id: uuid.UUID,
    body: NewCardBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 1: any member writes a post-it in a Retro column of the open
    round. It starts as a draft only they see, so nobody else is told."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    column = _column_or_404(write, body.column_id, locale)
    round_ = write.board.round_of(column)
    try:
        text = clean_body(body.body)
        count = 0
        if round_ is not None:
            round_columns = [c.id for c in write.board.retro_columns(round_.id)]
            count = await session_zero_repo.count_cards(
                session, round_columns, drafts_of=write.viewer.user_id
            )
        ensure_can_add_card(column, round_, count)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.add_card(
        session, room_id, column.id, write.viewer.user_id, text, datetime.now(UTC)
    )
    return await _answer(session, room_id, write, locale)


@router.patch("/cards/{card_id}")
async def edit_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    body: CardBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 9: the author rewrites their own Retro post-it while its
    round is open; a published one changes for everyone at once."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    try:
        ensure_can_edit_card(card, write.board.round_of(column), write.viewer.user_id)
        text = clean_body(body.body)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.update_card(session, card.id, datetime.now(UTC), body=text)
    if not card.is_draft:
        await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.delete("/cards/{card_id}")
async def delete_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 9: the author deletes their post-it, the Master any
    published one; a Lines & Veils copy goes with the Master or its
    original's author. The original's copies stay."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    try:
        ensure_can_delete_card(
            card, write.board.round_of(column), write.viewer.user_id, write.viewer.role
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.delete_card(session, card.id)
    if not card.is_draft:
        await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.post("/cards/{card_id}/publish")
async def publish_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    body: PublishBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decisions 1 and 7: the author shows their draft to every member,
    signed or anonymous. Can't be undone (409 the second time)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    round_ = write.board.round_of(column)
    published = 0
    if round_ is not None:
        round_columns = [c.id for c in write.board.retro_columns(round_.id)]
        published = await session_zero_repo.count_cards(session, round_columns)
    try:
        ensure_can_publish(card, round_, write.viewer.user_id, published)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    now = datetime.now(UTC)
    await session_zero_repo.update_card(
        session, card.id, now, published_at=now, anonymous=body.anonymous
    )
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.post("/cards/{card_id}/promote")
async def promote_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    body: TargetColumnBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decisions 2 and 8: the Master copies a published Retro post-it, of any
    round, into a Lines & Veils column. 409 when that column already has a
    copy of it; Players get 403."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    target = _column_or_404(write, body.column_id, locale)
    lines_veils = [c.id for c in write.board.lines_veils_columns()]
    try:
        ensure_can_promote(
            card,
            column,
            target,
            write.viewer.role,
            await session_zero_repo.list_copy_columns(session, card.id),
            await session_zero_repo.count_cards(session, lines_veils),
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.copy_card(
        session, card, target.id, write.viewer.user_id, datetime.now(UTC)
    )
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.post("/cards/{card_id}/move")
async def move_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    body: TargetColumnBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 16: the Master moves a Lines & Veils post-it to another of
    its columns (a Line becomes a Veil). 409 when a copy of the same
    original is already there."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    target = _column_or_404(write, body.column_id, locale)
    try:
        ensure_can_move(
            card,
            column,
            target,
            write.viewer.role,
            await session_zero_repo.list_sources_in_column(session, target.id),
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if target.id != column.id:
        await session_zero_repo.update_card(
            session, card.id, datetime.now(UTC), column_id=target.id
        )
        await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.put("/cards/{card_id}/reactions/{emoji}")
async def add_reaction(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    emoji: str,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 5: any member reacts to a published post-it with one emoji
    (422 otherwise), not in a closed round. Idempotent: an emoji already
    there changes nothing, so it doesn't bump `revision`."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    clean = _parse_emoji(emoji, locale)
    existing = (await session_zero_repo.list_reactions(session, [card.id]))[card.id]
    try:
        ensure_can_react(
            card,
            write.board.round_of(column),
            clean,
            {reaction.emoji for reaction in existing},
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if await session_zero_repo.add_reaction(
        session, card.id, write.viewer.user_id, clean, datetime.now(UTC)
    ):
        await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.delete("/cards/{card_id}/reactions/{emoji}")
async def remove_reaction(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    emoji: str,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """The caller takes back their own emoji. Idempotent: `revision` moves
    only when there was one to take back (never on a draft, which has none)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    clean = _parse_emoji(emoji, locale)
    try:
        ensure_round_open(write.board.round_of(column))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if await session_zero_repo.remove_reaction(session, card.id, write.viewer.user_id, clean):
        await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.post("/columns")
async def add_column(
    room_id: uuid.UUID,
    body: ColumnBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 10: the Master adds a Retro column, last, to the open round."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    open_round = write.board.open_round
    columns = write.board.retro_columns(open_round.id)
    try:
        ensure_master(write.viewer.role)
        title = clean_column_title(body.title)
        ensure_can_add_column(open_round, len(columns))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    position = max((c.position for c in columns), default=-1) + 1
    await session_zero_repo.add_column(session, room_id, open_round.id, title, position)
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.patch("/columns/{column_id}")
async def rename_column(
    room_id: uuid.UUID,
    column_id: uuid.UUID,
    body: ColumnBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 10: the Master renames a Retro column of the open round."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    column = _column_or_404(write, column_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_retro_column(column, write.board.round_of(column))
        title = clean_column_title(body.title)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.rename_column(session, column.id, title)
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.delete("/columns/{column_id}")
async def delete_column(
    room_id: uuid.UUID,
    column_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 10: the Master deletes a Retro column of the open round, with
    its post-its (the client asks for confirmation first)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    column = _column_or_404(write, column_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_retro_column(column, write.board.round_of(column))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.delete_column(session, column.id)
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.put("/columns/order")
async def reorder_columns(
    room_id: uuid.UUID,
    body: ColumnOrderBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 10: the Master reorders the open round's Retro columns. The
    list must name each of them exactly once (422 otherwise)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    current = {c.id for c in write.board.retro_columns(write.board.open_round.id)}
    if len(body.column_ids) != len(current) or set(body.column_ids) != current:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.columnOrder", locale
        )
    await session_zero_repo.set_column_positions(session, body.column_ids)
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.post("/rounds")
async def start_round(
    room_id: uuid.UUID,
    body: RoundBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 16: the Master starts a Session 0.5. The open round closes
    (read-only, its drafts dropped) and a new one opens, empty, with the
    same Retro column titles. Lines & Veils carries over."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
        title = clean_round_title(body.title)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    current = write.board.open_round
    now = datetime.now(UTC)
    await session_zero_repo.close_round(session, current.id, now)
    await session_zero_repo.add_round(
        session,
        room_id,
        current.number + 1,
        title,
        [column.title for column in write.board.retro_columns(current.id)],
        now,
    )
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)


@router.post("/timer")
async def set_timer(
    room_id: uuid.UUID,
    body: TimerBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 4: the Master starts (60 s to 1 h), pauses, resumes or stops
    the shared timer. It never blocks writing."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    state = await session_zero_repo.get_state(session, room_id)
    assert state is not None
    try:
        ensure_master(write.viewer.role)
        timer = apply_timer(state[1], body.action, body.duration_s, datetime.now(UTC))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.set_timer(session, room_id, timer)
    await _shared(session, room_id)
    return await _answer(session, room_id, write, locale)

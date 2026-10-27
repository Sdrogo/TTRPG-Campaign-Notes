"""Session 0 boards (spec 46): a Room's Retro board, run in rounds, and its
Lines & Veils board. Every member reads and writes; drafts stay with their
authors (Decision 1). Every write answers with the open round's boards as
the caller sees them, and every write the other members see bumps the
Session 0's `revision` (Decision 3, for the live updates)."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.auth.dependencies import VIEW_AS_HEADER, CurrentUserDep, authenticated_user
from app.db import session as session_module
from app.db import session_zero_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import Membership
from app.domain.reactions import InvalidEmojiError, parse_emoji, summarize_reactions
from app.domain.relationship_maps import MapColor
from app.domain.session_zero import (
    AlreadyPromotedError,
    AlreadyPublishedError,
    BoardFullError,
    Card,
    Column,
    CopyNotEditableError,
    DraftCardError,
    Group,
    InvalidCardError,
    InvalidTimerError,
    InvalidTitleError,
    LinesVeilsKind,
    NotAuthorError,
    NotGroupableError,
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
    can_group,
    can_promote,
    clean_body,
    clean_column_title,
    clean_group_title,
    clean_round_title,
    ensure_can_add_card,
    ensure_can_add_column,
    ensure_can_delete_card,
    ensure_can_edit_card,
    ensure_can_group,
    ensure_can_move,
    ensure_can_promote,
    ensure_can_publish,
    ensure_can_react,
    ensure_master,
    ensure_retro_column,
    ensure_round_open,
    is_card_visible,
    is_master,
    publishable_count,
    remaining_seconds,
    shown_author,
)
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate
from app.realtime.broker import Event, broker

router = APIRouter(prefix="/rooms/{room_id}/session-zero", tags=["session-zero"])

# Decision 10: the Retro board's first columns, named in the language of
# whoever starts the Session 0, coloured like a traffic light (spec 46c
# Decisions 4 and 5).
PRESET_COLUMNS = (
    ("sessionZero.presets.want", MapColor.GREEN),
    ("sessionZero.presets.care", MapColor.GOLD),
    ("sessionZero.presets.avoid", MapColor.RED),
)

# A comment line this often keeps proxies (Caddy, Render) from closing an
# idle stream (spec 46_2).
KEEPALIVE_S = 25.0

_bearer = HTTPBearer(auto_error=False)

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
    NotGroupableError: status.HTTP_422_UNPROCESSABLE_CONTENT,
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
    Veils copy (Decision 2); `group_id` its group (spec 46c Decision 9).
    The `can_*` flags drive the menu."""

    id: uuid.UUID
    column_id: uuid.UUID
    group_id: uuid.UUID | None
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
    can_group: bool


class GroupResponse(BaseModel):
    """A group of post-its in a Retro column (spec 46c Decision 9)."""

    id: uuid.UUID
    title: str | None


class ColumnResponse(BaseModel):
    """A column, its groups and its post-its, oldest first. `kind` is set on
    the Lines & Veils columns (`must`, `veils`, `lines`), whose title the
    client names; `color` is a `MapColor` (spec 46c Decision 5)."""

    id: uuid.UUID
    kind: str | None
    title: str
    color: str
    groups: list[GroupResponse]
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
    """A new post-it: in a Retro column, or the Master's on Lines & Veils."""

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
    """A Retro column's title and colour; on a change, what changes."""

    title: str | None = None
    color: MapColor | None = None


class GroupBody(BaseModel):
    """The post-its to group (spec 46c Decision 9)."""

    card_ids: list[uuid.UUID]


class GroupTitleBody(BaseModel):
    """A group's title; empty clears it."""

    title: str | None = None


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
        """The three Lines & Veils columns, in their fixed order (spec 46c
        Decision 5), whatever order they were stored in."""
        order = list(LinesVeilsKind)
        found = [c for c in self.columns.values() if c.kind is not None]
        return sorted(found, key=lambda c: order.index(c.kind))  # type: ignore[arg-type]


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
    groups = await session_zero_repo.list_groups(session, [column.id for column in retro])

    def card_response(card: Card) -> CardResponse:
        column = board.columns[card.column_id]
        round_ = board.round_of(column)
        open_ = round_ is None or round_.closed_at is None
        mine = card.author_id == viewer.user_id
        return CardResponse(
            id=card.id,
            column_id=card.column_id,
            group_id=card.group_id,
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
            can_group=can_group(card, column, round_, viewer.role),
        )

    def column_response(column: Column) -> ColumnResponse:
        return ColumnResponse(
            id=column.id,
            kind=column.kind.value if column.kind else None,
            title=column.title,
            color=column.shown_color.value,
            groups=[
                GroupResponse(id=group.id, title=group.title)
                for group in groups
                if group.column_id == column.id
            ],
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
    revision: int


async def _begin_write(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> _Write:
    """Checks membership, then takes the Session 0's row lock (409 before it
    is started), so the Room's board writes happen one at a time."""
    viewer = await require_membership(session, room_id, user_id, locale)
    state = await session_zero_repo.get_state(session, room_id, lock=True)
    if state is None:
        raise http_error(status.HTTP_409_CONFLICT, "errors.sessionZero.notStarted", locale)
    return _Write(viewer=viewer, board=await _load_board(session, room_id), revision=state[0])


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


async def _group_or_404(
    session: AsyncSession, write: _Write, group_id: uuid.UUID, locale: str
) -> tuple[Group, Column]:
    found = await session_zero_repo.get_group(session, group_id)
    if found is None or found[1] != write.viewer.room_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.groupNotFound", locale)
    group = found[0]
    return group, write.board.columns[group.column_id]


def _push(
    session: AsyncSession, room_id: uuid.UUID, event: Event, user_id: uuid.UUID | None = None
) -> None:
    """Sends `event` once the write has committed (spec 46_2): to the whole
    Room, or to `user_id`'s own streams only."""

    async def send(_: AsyncSession) -> None:
        broker.publish(room_id, event, user_id=user_id)

    session_module.on_commit(session, send)


async def _shared(
    session: AsyncSession, room_id: uuid.UUID, kind: str, item_id: uuid.UUID | None = None
) -> None:
    """Marks a write every member sees (Decision 3) and tells their open
    streams; a draft's never is."""
    revision = await session_zero_repo.bump_revision(session, room_id)
    _push(session, room_id, Event(revision, kind, item_id))


def _private(session: AsyncSession, write: _Write, card_id: uuid.UUID) -> None:
    """A draft's write: only its author's other tabs hear of it, at the
    unchanged revision, so nobody else learns the draft exists."""
    _push(
        session,
        write.viewer.room_id,
        Event(write.revision, "card", card_id),
        user_id=write.viewer.user_id,
    )


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
    Session 0 - round 1 with the three preset Retro columns, named in their
    language, and the Must / Veils / Lines columns. Idempotent."""
    viewer = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    columns = [(translate(key, locale), color) for key, color in PRESET_COLUMNS]
    if await session_zero_repo.start(session, room_id, columns, datetime.now(UTC)):
        await _shared(session, room_id, "start")
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
    round. It starts as a draft only they see, so nobody else is told. The
    Master also writes directly on Lines & Veils, published at once (spec
    46c Decision 6)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    column = _column_or_404(write, body.column_id, locale)
    round_ = write.board.round_of(column)
    board_columns = (
        write.board.retro_columns(round_.id)
        if round_ is not None
        else write.board.lines_veils_columns()
    )
    try:
        text = clean_body(body.body)
        count = await session_zero_repo.count_cards(
            session, [c.id for c in board_columns], drafts_of=write.viewer.user_id
        )
        ensure_can_add_card(column, round_, count, write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    card_id = await session_zero_repo.add_card(
        session,
        room_id,
        column.id,
        write.viewer.user_id,
        text,
        datetime.now(UTC),
        published=not column.is_retro,
    )
    if column.is_retro:
        _private(session, write, card_id)
    else:
        await _shared(session, room_id, "card", card_id)
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
    if card.is_draft:
        _private(session, write, card.id)
    else:
        await _shared(session, room_id, "card", card.id)
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
    if card.group_id is not None:
        await session_zero_repo.prune_groups(session, column.id)
    if card.is_draft:
        _private(session, write, card.id)
    else:
        await _shared(session, room_id, "card", card.id)
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
    await _shared(session, room_id, "card", card.id)
    return await _answer(session, room_id, write, locale)


@router.post("/cards/publish-all")
async def publish_all_cards(
    room_id: uuid.UUID,
    body: PublishBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46c Decision 8: the caller publishes all their drafts of the open
    round at once, all signed or all anonymous, oldest first while the board
    has room; the rest stay drafts. Nothing to publish changes nothing; a
    full board with drafts waiting is 409."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    round_columns = [c.id for c in write.board.retro_columns(write.board.open_round.id)]
    drafts = await session_zero_repo.list_drafts(session, round_columns, write.viewer.user_id)
    if drafts:
        published = await session_zero_repo.count_cards(session, round_columns)
        try:
            count = publishable_count(len(drafts), published)
        except DomainError as exc:
            raise _domain_error(exc, locale) from exc
        await session_zero_repo.publish_cards(
            session, drafts[:count], body.anonymous, datetime.now(UTC)
        )
        await _shared(session, room_id, "card")
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
    copy_id = await session_zero_repo.copy_card(
        session, card, target.id, write.viewer.user_id, datetime.now(UTC)
    )
    await _shared(session, room_id, "card", copy_id)
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
        await _shared(session, room_id, "card", card.id)
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
        await _shared(session, room_id, "reaction", card.id)
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
        await _shared(session, room_id, "reaction", card.id)
    return await _answer(session, room_id, write, locale)


@router.post("/columns")
async def add_column(
    room_id: uuid.UUID,
    body: ColumnBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 10: the Master adds a Retro column, last, to the open round,
    in the colour they pick (spec 46c Decision 5; `default` when none)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    open_round = write.board.open_round
    columns = write.board.retro_columns(open_round.id)
    try:
        ensure_master(write.viewer.role)
        title = clean_column_title(body.title or "")
        ensure_can_add_column(open_round, len(columns))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    position = max((c.position for c in columns), default=-1) + 1
    column_id = await session_zero_repo.add_column(
        session, room_id, open_round.id, title, body.color or MapColor.DEFAULT, position
    )
    await _shared(session, room_id, "column", column_id)
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
    """Decision 10: the Master renames a Retro column of the open round, or
    changes its colour (spec 46c Decision 5)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    column = _column_or_404(write, column_id, locale)
    values: dict[str, object] = {}
    try:
        ensure_master(write.viewer.role)
        ensure_retro_column(column, write.board.round_of(column))
        if body.title is not None:
            values["title"] = clean_column_title(body.title)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if body.color is not None:
        values["color"] = body.color.value
    if not values:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.nothingToChange", locale
        )
    await session_zero_repo.update_column(session, column.id, **values)
    await _shared(session, room_id, "column", column.id)
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
    await _shared(session, room_id, "column", column.id)
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
    await _shared(session, room_id, "column")
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
    same Retro column titles and colours, without groups. Lines & Veils
    carries over."""
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
        [(column.title, column.color) for column in write.board.retro_columns(current.id)],
        now,
    )
    await _shared(session, room_id, "round")
    return await _answer(session, room_id, write, locale)


@router.post("/groups")
async def group_cards(
    room_id: uuid.UUID,
    body: GroupBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46c Decision 9: the Master groups published post-its of one
    Retro column of the open round. Post-its already grouped bring their
    groups along: everything lands in the first post-it's group (or a new
    one), and the groups left empty go."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card_ids = list(dict.fromkeys(body.card_ids))
    found = [await _card_or_404(session, write, card_id, locale) for card_id in card_ids]
    cards = [card for card, _ in found]
    column = found[0][1] if found else None
    try:
        ensure_master(write.viewer.role)
        if column is None:
            raise NotGroupableError("errors.sessionZero.notGroupable")
        ensure_can_group(cards, column, write.board.round_of(column), write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    assert column is not None
    existing = list(dict.fromkeys(c.group_id for c in cards if c.group_id is not None))
    if existing:
        target, merged = existing[0], existing[1:]
        await session_zero_repo.move_group_cards(session, merged, target)
        await session_zero_repo.delete_groups(session, merged)
    else:
        target = await session_zero_repo.add_group(session, room_id, column.id, datetime.now(UTC))
    await session_zero_repo.set_group(session, card_ids, target)
    await _shared(session, room_id, "group", target)
    return await _answer(session, room_id, write, locale)


@router.patch("/groups/{group_id}")
async def rename_group(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    body: GroupTitleBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46c Decision 9: the Master titles a group; empty clears it."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    group, column = await _group_or_404(session, write, group_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_round_open(write.board.round_of(column))
        title = clean_group_title(body.title)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.rename_group(session, group.id, title)
    await _shared(session, room_id, "group", group.id)
    return await _answer(session, room_id, write, locale)


@router.delete("/groups/{group_id}")
async def ungroup_all(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46c Decision 9: the Master dissolves a group; its post-its stay."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    group, column = await _group_or_404(session, write, group_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_round_open(write.board.round_of(column))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.delete_groups(session, [group.id])
    await _shared(session, room_id, "group", group.id)
    return await _answer(session, room_id, write, locale)


@router.post("/cards/{card_id}/ungroup")
async def ungroup_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46c Decision 9: the Master takes a post-it out of its group; a
    group left with one post-it dissolves. A post-it in no group changes
    nothing."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_round_open(write.board.round_of(column))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if card.group_id is not None:
        await session_zero_repo.set_group(session, [card.id], None)
        await session_zero_repo.prune_groups(session, column.id)
        await _shared(session, room_id, "group", card.group_id)
    return await _answer(session, room_id, write, locale)


@router.delete("")
async def delete_session_zero(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> SessionZeroResponse:
    """Spec 46c Decision 3: the Master deletes the Room's Session 0 and
    everything in it, drafts included; any member can then start a new one.
    Every open page is told (`reset`)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.delete_session_zero(session, room_id)
    _push(session, room_id, Event(write.revision + 1, "reset", None))
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
    await _shared(session, room_id, "timer")
    return await _answer(session, room_id, write, locale)


def _sse(event: Event) -> str:
    payload = {"revision": event.revision, "kind": event.kind, "id": event.id}
    return f"data: {json.dumps(payload, default=str)}\n\n"


async def _stream(room_id: uuid.UUID, user_id: uuid.UUID) -> AsyncIterator[str]:
    """The stream's lines until it is closed (`None`): the member left, the
    Room is gone, or they fell too far behind. Subscribes only once the
    response starts streaming, in the same `try` that forgets the stream
    however it ends, the client hanging up included."""
    subscription = broker.subscribe(room_id, user_id)
    try:
        yield ": open\n\n"
        while True:
            try:
                event = await asyncio.wait_for(subscription.queue.get(), KEEPALIVE_S)
            except TimeoutError:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                return
            yield _sse(event)
    finally:
        broker.unsubscribe(subscription)


@router.get("/events")
async def session_zero_events(
    room_id: uuid.UUID,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    locale: LocaleDep,
) -> StreamingResponse:
    """Spec 46_2: Server-Sent Events, one line per write the caller may hear
    of, `{"revision", "kind", "id"}` and never any content; the client then
    re-reads the board with `GET`. Membership is checked once, on a session
    closed before the stream starts, so an open stream holds no database
    connection. A "View as" header is ignored: the stream is the caller's.
    The token is checked when the stream opens only: an open stream outlives
    its expiry, which is harmless since it carries no content, and the
    client's next `GET` needs a fresh token anyway."""
    user_id = uuid.UUID(authenticated_user(credentials, locale).id)
    async with session_module.independent_session() as session:
        await require_membership(session, room_id, user_id, locale)
    return StreamingResponse(
        _stream(room_id, user_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

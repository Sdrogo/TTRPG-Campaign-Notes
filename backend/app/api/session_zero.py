"""Session 0 boards (spec 46): a Room's sessions (rounds), each a chain of
modules the Master composes and walks the table through (spec 47), and its
Room-wide Lines & Veils board. Every member reads and writes; drafts stay
with their authors (Decision 1); a Player sees the steps already reached
(spec 47 Decision 5). Every write answers with the open round's boards as
the caller sees them, and every write the other members see bumps the
Session 0's `revision` (Decision 3, for the live updates)."""

import uuid
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
from app.api.events import open_room_stream
from app.auth.dependencies import VIEW_AS_HEADER, CurrentUserDep
from app.db import (
    documents_repo,
    rooms_repo,
    session_zero_ddi_repo,
    session_zero_questions_repo,
    session_zero_repo,
    tags_repo,
    versions_repo,
)
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import Document, Membership, RoomRole
from app.domain.reactions import InvalidEmojiError, parse_emoji, summarize_reactions
from app.domain.relationship_maps import MapColor
from app.domain.session_zero import (
    DEFAULT_CHAIN,
    AlreadyPromotedError,
    AlreadyPublishedError,
    BadPlaceError,
    BoardFullError,
    Card,
    Column,
    CopyNotEditableError,
    DraftCardError,
    Group,
    InvalidCardError,
    InvalidChainError,
    InvalidTimerError,
    InvalidTitleError,
    LastModuleError,
    LinesVeilsKind,
    Module,
    ModuleKind,
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
    can_place,
    can_promote,
    carry_source,
    clean_body,
    clean_chain,
    clean_column_title,
    clean_group_title,
    clean_round_title,
    current_after_removal,
    ensure_can_add_card,
    ensure_can_add_column,
    ensure_can_add_module,
    ensure_can_delete_card,
    ensure_can_edit_card,
    ensure_can_group,
    ensure_can_move,
    ensure_can_place_card,
    ensure_can_place_group,
    ensure_can_promote,
    ensure_can_publish,
    ensure_can_react,
    ensure_can_remove_module,
    ensure_master,
    ensure_retro_column,
    ensure_round_open,
    is_card_visible,
    is_master,
    placed,
    publishable_count,
    remaining_seconds,
    shown_author,
    visible_modules,
)
from app.domain.session_zero_ddi import (
    MasterDoesNotAcceptError,
    NoDdiDocumentError,
    NotDdiModuleError,
    can_read_acceptance,
    is_outdated,
)
from app.domain.session_zero_questions import (
    CreationDisabledError,
    DocumentExistsError,
    InvalidAnswerError,
    InvalidQuestionsError,
    MasterDoesNotAnswerError,
    NameAnswerMissingError,
    NotQuestionsModuleError,
    QuestionTarget,
    can_read_answer,
    may_create,
)
from app.domain.visibility import is_document_visible
from app.i18n.dependencies import LocaleDep
from app.i18n.translator import translate
from app.realtime.audience import push
from app.realtime.broker import SESSION_ZERO, Event

router = APIRouter(prefix="/rooms/{room_id}/session-zero", tags=["session-zero"])

# Decision 10: the Retro board's first columns, named in the language of
# whoever starts the Session 0, coloured like a traffic light (spec 46c
# Decisions 4 and 5).
PRESET_COLUMNS = (
    ("sessionZero.presets.want", MapColor.GREEN),
    ("sessionZero.presets.care", MapColor.GOLD),
    ("sessionZero.presets.avoid", MapColor.RED),
)

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
    BadPlaceError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidChainError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    LastModuleError: status.HTTP_409_CONFLICT,
    InvalidQuestionsError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidAnswerError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    NotQuestionsModuleError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    MasterDoesNotAnswerError: status.HTTP_403_FORBIDDEN,
    NameAnswerMissingError: status.HTTP_409_CONFLICT,
    DocumentExistsError: status.HTTP_409_CONFLICT,
    CreationDisabledError: status.HTTP_403_FORBIDDEN,
    NotDdiModuleError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    NoDdiDocumentError: status.HTTP_409_CONFLICT,
    MasterDoesNotAcceptError: status.HTTP_403_FORBIDDEN,
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
    `position` is its place in its group, or among its column's post-its in
    no group and its groups (spec 46d Decision 7). The `can_*` flags drive
    the menu and the drag (`can_place`)."""

    id: uuid.UUID
    column_id: uuid.UUID
    group_id: uuid.UUID | None
    position: int
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
    can_place: bool


class GroupResponse(BaseModel):
    """A group of post-its in a Retro column (spec 46c Decision 9), at
    `position` among the column's post-its in no group (spec 46d)."""

    id: uuid.UUID
    title: str | None
    position: int


class ColumnResponse(BaseModel):
    """A column, its groups and its post-its, in order. `kind` is set on
    the fixed columns, Lines & Veils (`must`, `veils`, `lines`) and Stars
    and Wishes (`stars`, `wishes`), whose title the client names; `color`
    is a `MapColor` (spec 46c Decision 5)."""

    id: uuid.UUID
    kind: str | None
    title: str
    color: str
    groups: list[GroupResponse]
    cards: list[CardResponse]


class QuestionResponse(BaseModel):
    """A question and where its answer goes (spec 47 Decision 9)."""

    id: uuid.UUID
    position: int
    body: str
    hint: str | None
    target: QuestionTarget
    tag_id: uuid.UUID | None


class AnswerResponse(BaseModel):
    """An answer the caller may read (Decision 10, Q2)."""

    question_id: uuid.UUID
    user_id: uuid.UUID
    body: str
    note_private: bool
    updated_at: datetime
    mine: bool


class AnswerDocumentResponse(BaseModel):
    """A Document made from a Player's answers: their main one
    (`question_id` null) or a "New Document" question's (Decision 11)."""

    user_id: uuid.UUID
    question_id: uuid.UUID | None
    document_id: uuid.UUID
    mine: bool


class QuestionsResponse(BaseModel):
    """A Questions module (spec 47 Decisions 9-11): its settings, its
    questions, the answers and Documents the caller may see (their own, all
    of them for the Master or once revealed). `can_create`: the caller may
    make their Document now; `creatable`: for the Master, how many Players
    "Create everyone's Documents" would make one for."""

    tag_id: uuid.UUID | None
    answers_revealed: bool
    players_bypass_creation_rule: bool
    questions: list[QuestionResponse]
    answers: list[AnswerResponse]
    documents: list[AnswerDocumentResponse]
    can_create: bool
    creatable: int


class AcceptanceResponse(BaseModel):
    """A Player's acceptance of a DDI (spec 47 Decision 8); `outdated` once
    the Document changed after it."""

    user_id: uuid.UUID
    accepted_at: datetime
    outdated: bool
    mine: bool


class DdiResponse(BaseModel):
    """A DDI module (spec 47 Decision 8). `document_id` is its Document when
    the caller sees it; `document_hidden` says there is one they don't see
    yet. `changed_at` is the Document's last revision. The Master gets every
    acceptance, a Player their own; `can_accept` while the caller may accept
    (again, once the Document changed)."""

    document_id: uuid.UUID | None
    document_hidden: bool
    changed_at: datetime | None
    acceptances: list[AcceptanceResponse]
    can_accept: bool


class ModuleResponse(BaseModel):
    """A step of the shown session's chain (spec 47), with its columns: a
    Retro or Stars and Wishes module's own; none for Lines & Veils, whose
    board is the Room-wide `lines_veils`. A Questions module has
    `questions`, a DDI one `ddi`."""

    id: uuid.UUID
    kind: ModuleKind
    position: int
    columns: list[ColumnResponse]
    questions: QuestionsResponse | None = None
    ddi: DdiResponse | None = None


class RoundResponse(BaseModel):
    """A session (round, Decision 16)."""

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
    the rest is empty. `round_id` is the session shown; `modules` its chain
    as the caller sees it (spec 47 Decision 5: a Player the steps already
    reached, `hidden_modules` counting the later ones), on
    `current_module_id`."""

    started: bool
    revision: int
    can_manage: bool
    rounds: list[RoundResponse]
    round_id: uuid.UUID | None
    modules: list[ModuleResponse]
    current_module_id: uuid.UUID | None
    hidden_modules: int
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
    """A Retro column's title and colour; on a change, what changes. A new
    one goes to `module_id`, the open session's first Retro module when
    none."""

    title: str | None = None
    color: MapColor | None = None
    module_id: uuid.UUID | None = None


class GroupBody(BaseModel):
    """The post-its to group (spec 46c Decision 9)."""

    card_ids: list[uuid.UUID]


class GroupTitleBody(BaseModel):
    """A group's title; empty clears it."""

    title: str | None = None


class PlaceBody(BaseModel):
    """Where a dragged post-it or group lands (spec 46d Decision 7): in
    `column_id`, in its group `group_id` (a post-it only), just before
    `before_id` (a post-it or group there), or last when none."""

    column_id: uuid.UUID
    group_id: uuid.UUID | None = None
    before_id: uuid.UUID | None = None


class ColumnOrderBody(BaseModel):
    """A Retro module's columns, every one, in their new order."""

    column_ids: list[uuid.UUID]


class StartBody(BaseModel):
    """The first session's chain (spec 47 Decision 2), the Master's to
    choose; `DEFAULT_CHAIN` when none."""

    modules: list[ModuleKind] | None = None


class ChainStepBody(BaseModel):
    """A step of a new session's chain; `carry` brings an earlier session's
    content over (spec 47b Decision 2)."""

    kind: ModuleKind
    carry: bool = False


class RoundBody(BaseModel):
    """A new session's optional title (Decision 16) and its chain (spec 47
    Decision 2; a bare kind carries nothing); the previous session's chain,
    carrying nothing, when none."""

    title: str | None = None
    modules: list[ChainStepBody | ModuleKind] | None = None


class ModuleBody(BaseModel):
    """A module to add at the end of the open session's chain; `carry`
    brings an earlier session's content over (spec 47b Decision 2)."""

    kind: ModuleKind
    carry: bool = False


class ModuleOrderBody(BaseModel):
    """The open session's modules, every one, in their new order."""

    module_ids: list[uuid.UUID]


class CurrentModuleBody(BaseModel):
    """The step the table moves to (spec 47 Decision 4)."""

    module_id: uuid.UUID


class TimerBody(BaseModel):
    """What to do with the timer; `duration_s` only to start it."""

    action: TimerAction
    duration_s: int | None = None


@dataclass(frozen=True)
class _Board:
    """The Room's Session 0 as stored: rounds, their chains, columns and
    where each lives."""

    rounds: list[Round]
    columns: dict[uuid.UUID, Column]
    modules: list[Module]

    @property
    def open_round(self) -> Round:
        """The round that takes writes; there is always exactly one."""
        return next(round_ for round_ in self.rounds if round_.closed_at is None)

    def round_of(self, column: Column) -> Round | None:
        """The column's round, or `None` on the Lines & Veils board."""
        return next((r for r in self.rounds if r.id == column.round_id), None)

    def chain(self, round_id: uuid.UUID) -> list[Module]:
        """A round's modules, in order."""
        return [module for module in self.modules if module.round_id == round_id]

    def module_columns(self, module_id: uuid.UUID | None) -> list[Column]:
        """A module's columns, in order."""
        return [c for c in self.columns.values() if c.module_id == module_id]

    def visible_chain(self, round_: Round, viewer: Membership) -> list[Module]:
        """The round's steps `viewer` sees (spec 47 Decision 5)."""
        return visible_modules(self.chain(round_.id), round_.current_module_id, viewer.role)

    def hidden_modules(self, viewer: Membership) -> set[uuid.UUID]:
        """The modules, of every round, `viewer` hasn't reached yet."""
        seen = {m.id for round_ in self.rounds for m in self.visible_chain(round_, viewer)}
        return {module.id for module in self.modules} - seen

    def lines_veils_columns(self) -> list[Column]:
        """The three Lines & Veils columns, in their fixed order (spec 46c
        Decision 5), whatever order they were stored in."""
        order = list(LinesVeilsKind)
        found = [c for c in self.columns.values() if not c.is_retro]
        return sorted(found, key=lambda c: order.index(c.kind))  # type: ignore[arg-type]


async def _load_board(session: AsyncSession, room_id: uuid.UUID) -> _Board:
    rounds = await session_zero_repo.list_rounds(session, room_id)
    columns = await session_zero_repo.list_columns(session, room_id)
    modules = await session_zero_repo.list_modules(session, room_id)
    return _Board(rounds=rounds, columns={column.id: column for column in columns}, modules=modules)


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
            modules=[],
            current_module_id=None,
            hidden_modules=0,
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
    chain = board.visible_chain(shown, viewer)
    retro = [column for module in chain for column in board.module_columns(module.id)]
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
    questions = await _questions_responses(
        session, room_id, viewer, [m for m in chain if m.kind is ModuleKind.QUESTIONS], shown
    )
    ddis = await _ddi_responses(
        session, room_id, viewer, [m for m in chain if m.kind is ModuleKind.DDI], shown
    )

    def card_response(card: Card) -> CardResponse:
        column = board.columns[card.column_id]
        round_ = board.round_of(column)
        open_ = round_ is None or round_.closed_at is None
        mine = card.author_id == viewer.user_id
        return CardResponse(
            id=card.id,
            column_id=card.column_id,
            group_id=card.group_id,
            position=card.position,
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
            can_group=can_group(card, column, round_, viewer.user_id, viewer.role),
            can_place=can_place(card, column, round_, viewer.user_id, viewer.role),
        )

    def column_response(column: Column) -> ColumnResponse:
        return ColumnResponse(
            id=column.id,
            kind=column.kind.value if column.kind else None,
            title=column.title,
            color=column.shown_color.value,
            groups=[
                GroupResponse(id=group.id, title=group.title, position=group.position)
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
        modules=[
            ModuleResponse(
                id=module.id,
                kind=module.kind,
                position=module.position,
                columns=[column_response(c) for c in board.module_columns(module.id)],
                questions=questions.get(module.id),
                ddi=ddis.get(module.id),
            )
            for module in chain
        ],
        current_module_id=shown.current_module_id,
        hidden_modules=len(board.chain(shown.id)) - len(chain),
        lines_veils=[column_response(column) for column in lines_veils],
        timer=_timer_response(timer, now),
    )


async def _ddi_responses(
    session: AsyncSession,
    room_id: uuid.UUID,
    viewer: Membership,
    modules: list[Module],
    round_: Round,
) -> dict[uuid.UUID, DdiResponse]:
    """The DDI modules on screen as `viewer` sees them (spec 47 Decision 8):
    the Document only when they see it (D-08), the acceptances theirs or,
    for the Master, everyone's."""
    if not modules:
        return {}
    acceptances = await session_zero_ddi_repo.list_acceptances(session, [m.id for m in modules])
    open_ = round_.closed_at is None
    responses: dict[uuid.UUID, DdiResponse] = {}
    for module in modules:
        document = (
            await documents_repo.get_document(session, module.document_id)
            if module.document_id
            else None
        )
        visible = document is not None and await _sees_document(session, document, viewer)
        changed_at = await _changed_at(session, document) if visible and document else None
        mine = next(
            (a for a in acceptances if a.module_id == module.id and a.user_id == viewer.user_id),
            None,
        )
        responses[module.id] = DdiResponse(
            document_id=document.id if visible and document else None,
            document_hidden=document is not None and not visible,
            changed_at=changed_at,
            acceptances=[
                AcceptanceResponse(
                    user_id=a.user_id,
                    accepted_at=a.accepted_at,
                    outdated=is_outdated(a, changed_at),
                    mine=a.user_id == viewer.user_id,
                )
                for a in acceptances
                if a.module_id == module.id
                and document is not None
                and can_read_acceptance(a, viewer.user_id, viewer.role)
            ],
            can_accept=open_
            and visible
            and not is_master(viewer.role)
            and (mine is None or is_outdated(mine, changed_at)),
        )
    return responses


async def _sees_document(session: AsyncSession, document: Document, viewer: Membership) -> bool:
    """Whether `viewer` sees the Document (D-08, Invariant 1)."""
    owners = await documents_repo.list_owner_ids(session, document.id)
    grants = await documents_repo.list_selective_grant_ids(session, document.id)
    return is_document_visible(document, viewer.user_id, viewer.role, owners, grants)


async def _changed_at(session: AsyncSession, document: Document) -> datetime | None:
    """When the Document last changed: its latest revision's time (spec 24b:
    name, description and Notes); None for one with no history yet."""
    latest = await versions_repo.get_latest_version(session, document.id)
    return latest.updated_at if latest else None


async def _questions_responses(
    session: AsyncSession,
    room_id: uuid.UUID,
    viewer: Membership,
    modules: list[Module],
    round_: Round,
) -> dict[uuid.UUID, QuestionsResponse]:
    """The Questions modules on screen as `viewer` sees them (spec 47
    Decisions 10 and 11)."""
    if not modules:
        return {}
    module_ids = [module.id for module in modules]
    all_questions = await session_zero_questions_repo.list_questions(session, module_ids)
    all_answers = await session_zero_questions_repo.list_answers(
        session, [question.id for question in all_questions]
    )
    links = await session_zero_questions_repo.list_answer_documents(session, module_ids)
    room = await rooms_repo.get_room(session, room_id)
    players = {
        m.user_id
        for m in await rooms_repo.list_memberships(session, room_id)
        if m.role is RoomRole.PLAYER
    }
    master = is_master(viewer.role)
    open_ = round_.closed_at is None
    responses: dict[uuid.UUID, QuestionsResponse] = {}
    for module in modules:
        questions = [q for q in all_questions if q.module_id == module.id]
        ids = {q.id for q in questions}
        answers = [a for a in all_answers if a.question_id in ids]
        name_id = next((q.id for q in questions if q.target is QuestionTarget.NAME), None)
        named = {a.user_id for a in answers if a.question_id == name_id}
        documents = [link for link in links if link.module_id == module.id]
        with_document = {link.user_id for link in documents if link.question_id is None}
        allowed = room is not None and may_create(
            viewer.role, room.players_can_create_documents, module.players_bypass_creation_rule
        )
        responses[module.id] = QuestionsResponse(
            tag_id=module.tag_id,
            answers_revealed=module.answers_revealed,
            players_bypass_creation_rule=module.players_bypass_creation_rule,
            questions=[
                QuestionResponse(
                    id=q.id,
                    position=q.position,
                    body=q.body,
                    hint=q.hint,
                    target=q.target,
                    tag_id=q.tag_id,
                )
                for q in questions
            ],
            answers=[
                AnswerResponse(
                    question_id=a.question_id,
                    user_id=a.user_id,
                    body=a.body,
                    note_private=a.note_private,
                    updated_at=a.updated_at,
                    mine=a.user_id == viewer.user_id,
                )
                for a in answers
                if can_read_answer(a, viewer.user_id, viewer.role, module.answers_revealed)
            ],
            documents=[
                AnswerDocumentResponse(
                    user_id=link.user_id,
                    question_id=link.question_id,
                    document_id=link.document_id,
                    mine=link.user_id == viewer.user_id,
                )
                for link in documents
                if master or module.answers_revealed or link.user_id == viewer.user_id
            ],
            can_create=open_
            and not master
            and allowed
            and viewer.user_id in named
            and viewer.user_id not in with_document,
            creatable=len((named & players) - with_document) if master and open_ else 0,
        )
    return responses


@dataclass(frozen=True)
class _Write:
    """What every write starts from: the caller's Membership, the board,
    under the Session 0's row lock."""

    viewer: Membership
    board: _Board
    revision: int

    @property
    def hidden(self) -> set[uuid.UUID]:
        """The modules the caller hasn't reached: their columns, groups and
        post-its answer 404 (spec 47 Decision 5)."""
        return self.board.hidden_modules(self.viewer)


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
    if column is None or column.module_id in write.hidden:
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
        or write.board.columns[card.column_id].module_id in write.hidden
    ):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.cardNotFound", locale)
    return card, write.board.columns[card.column_id]


async def _group_or_404(
    session: AsyncSession, write: _Write, group_id: uuid.UUID, locale: str
) -> tuple[Group, Column]:
    found = await session_zero_repo.get_group(session, group_id)
    if (
        found is None
        or found[1] != write.viewer.room_id
        or write.board.columns[found[0].column_id].module_id in write.hidden
    ):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.groupNotFound", locale)
    group = found[0]
    return group, write.board.columns[group.column_id]


def _push(
    session: AsyncSession, room_id: uuid.UUID, event: Event, user_id: uuid.UUID | None = None
) -> None:
    """Sends `event` once the write has committed (spec 46_2): to the whole
    Room, or to `user_id`'s own streams only."""
    push(session, room_id, event, None if user_id is None else {user_id})


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


def _preset_columns(locale: str) -> list[session_zero_repo.RetroColumnSpec]:
    """A new Retro module's columns, named in `locale` (Decision 10)."""
    return [(translate(key, locale), color) for key, color in PRESET_COLUMNS]


async def _default_tag(session: AsyncSession, room_id: uuid.UUID) -> uuid.UUID | None:
    """A new Questions module's Tag (spec 47 Decision 9): the Room's `PC`,
    if it still has one."""
    tags = await tags_repo.list_tags(session, room_id)
    return next((tag.id for tag in tags if tag.name.casefold() == "pc"), None)


async def _set_up_modules(
    session: AsyncSession,
    room_id: uuid.UUID,
    round_id: uuid.UUID,
    sources: list[Module | None],
    now: datetime,
    *,
    only: uuid.UUID | None = None,
) -> None:
    """A new round's Questions and DDI modules, in chain order: each takes
    its source's settings when it carries one over (spec 47b): a Questions
    one its questions too, or the default Tag when it has no source; a DDI
    one its Document, without acceptances. `only` sets up that one module
    of the round, with the one source."""
    created = [
        module
        for module in await session_zero_repo.list_modules(session, room_id)
        if module.round_id == round_id and only in (None, module.id)
    ]
    default: uuid.UUID | None = None
    for module, source in zip(created, sources, strict=True):
        if module.kind is ModuleKind.DDI and source is not None:
            await session_zero_repo.set_module_settings(
                session, module.id, document_id=source.document_id
            )
        if module.kind is not ModuleKind.QUESTIONS:
            continue
        if source is None:
            default = default or await _default_tag(session, room_id)
            await session_zero_repo.set_module_settings(session, module.id, tag_id=default)
            continue
        await session_zero_repo.set_module_settings(
            session,
            module.id,
            tag_id=source.tag_id,
            players_bypass_creation_rule=source.players_bypass_creation_rule,
        )
        await session_zero_questions_repo.copy_questions(
            session, room_id, source.id, module.id, now
        )


@router.post("/start")
async def start_session_zero(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    body: StartBody | None = None,
) -> SessionZeroResponse:
    """Decision 10, spec 47 Decision 2: any member starts the Room's Session
    0 - round 1 with its chain (only the Master chooses one, 403 for anyone
    else; `DEFAULT_CHAIN` otherwise), the Retro modules with the preset
    columns named in their language, and the Must / Veils / Lines columns.
    Idempotent."""
    viewer = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    kinds = body.modules if body is not None else None
    try:
        if kinds is not None:
            ensure_master(viewer.role)
        chain = clean_chain(kinds if kinds is not None else DEFAULT_CHAIN)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    presets = _preset_columns(locale)
    specs = [(kind, presets) for kind in chain]
    now = datetime.now(UTC)
    if await session_zero_repo.start(session, room_id, specs, now):
        first = (await session_zero_repo.list_rounds(session, room_id))[0]
        await _set_up_modules(session, room_id, first.id, [None] * len(chain), now)
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
        write.board.module_columns(column.module_id)
        if column.is_retro
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
    if column.is_retro:
        module_columns = [c.id for c in write.board.module_columns(column.module_id)]
        published = await session_zero_repo.count_cards(session, module_columns)
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
    round at once, all signed or all anonymous, oldest first while each
    module's board has room (spec 47); the rest stay drafts. Nothing to
    publish changes nothing; drafts waiting only on full boards is 409."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    to_publish: list[uuid.UUID] = []
    full: DomainError | None = None
    for module in write.board.chain(write.board.open_round.id):
        module_columns = [c.id for c in write.board.module_columns(module.id)]
        drafts = await session_zero_repo.list_drafts(session, module_columns, write.viewer.user_id)
        if not drafts:
            continue
        published = await session_zero_repo.count_cards(session, module_columns)
        try:
            to_publish += drafts[: publishable_count(len(drafts), published)]
        except DomainError as exc:
            full = exc
    if not to_publish and full is not None:
        raise _domain_error(full, locale)
    if to_publish:
        await session_zero_repo.publish_cards(
            session, to_publish, body.anonymous, datetime.now(UTC)
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
            session,
            card.id,
            datetime.now(UTC),
            column_id=target.id,
            position=await session_zero_repo.next_position(session, target.id),
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
    """Decision 10: the Master adds a column, last, to a Retro module of the
    open round (`module_id`, its first Retro module when none), in the
    colour they pick (spec 46c Decision 5; `default` when none)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    open_round = write.board.open_round
    try:
        ensure_master(write.viewer.role)
        module = _retro_module(write, body.module_id, locale)
        columns = write.board.module_columns(module.id)
        title = clean_column_title(body.title or "")
        ensure_can_add_column(open_round, len(columns))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    position = max((c.position for c in columns), default=-1) + 1
    column_id = await session_zero_repo.add_column(
        session, room_id, module, title, body.color or MapColor.DEFAULT, position
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
    """Decision 10: the Master reorders the columns of a Retro module of the
    open round. The list must name each of them exactly once (422
    otherwise)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    first = write.board.columns.get(body.column_ids[0]) if body.column_ids else None
    try:
        ensure_master(write.viewer.role)
        module = _retro_module(write, first.module_id if first else None, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    current = {c.id for c in write.board.module_columns(module.id)}
    if len(body.column_ids) != len(current) or set(body.column_ids) != current:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.columnOrder", locale
        )
    await session_zero_repo.set_column_positions(session, body.column_ids)
    await _shared(session, room_id, "column")
    return await _answer(session, room_id, write, locale)


def _earlier_chains(write: _Write, *, include_open: bool) -> list[list[Module]]:
    """The sessions' chains, newest first, a step can carry content over
    from (spec 47b Decision 4): the open one too when a new session
    replaces it."""
    rounds = sorted(write.board.rounds, key=lambda round_: round_.number, reverse=True)
    return [
        write.board.chain(round_.id)
        for round_ in rounds
        if include_open or round_.closed_at is not None
    ]


def _carried_columns(
    write: _Write, source: Module | None, presets: list[session_zero_repo.RetroColumnSpec]
) -> list[session_zero_repo.RetroColumnSpec]:
    """A new Retro step's columns: its source's titles and colours, or the
    presets."""
    if source is None or source.kind is not ModuleKind.RETRO:
        return presets
    return [(column.title, column.color) for column in write.board.module_columns(source.id)]


@router.post("/rounds")
async def start_round(
    room_id: uuid.UUID,
    body: RoundBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Decision 16, spec 47 Decision 2: the Master starts a new session. The
    open one closes (read-only, its drafts dropped) and the new one opens,
    empty, with the chain the Master composed (the previous one when none),
    on its first step. Each step starts empty (spec 47b) unless it carries
    an earlier session's content over: a Retro step its column titles and
    colours, without groups (the presets otherwise), a Questions step its
    questions and settings, without answers, a DDI step its Document,
    without acceptances. Lines & Veils carries over."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    current = write.board.open_round
    previous = write.board.chain(current.id)
    steps = [
        step if isinstance(step, ChainStepBody) else ChainStepBody(kind=step)
        for step in (body.modules if body.modules is not None else [m.kind for m in previous])
    ]
    try:
        ensure_master(write.viewer.role)
        title = clean_round_title(body.title)
        chain = clean_chain([step.kind for step in steps])
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    earlier = _earlier_chains(write, include_open=True)
    presets = _preset_columns(locale)
    specs: list[session_zero_repo.ModuleSpec] = []
    sources: list[Module | None] = []
    for kind, step in zip(chain, steps, strict=True):
        index = sum(1 for k, _ in specs if k is kind)
        source = carry_source(earlier, kind, index) if step.carry else None
        specs.append((kind, _carried_columns(write, source, presets)))
        sources.append(source)
    now = datetime.now(UTC)
    await session_zero_repo.close_round(session, current.id, now)
    round_id = await session_zero_repo.add_round(
        session, room_id, current.number + 1, title, specs, now
    )
    await _set_up_modules(session, room_id, round_id, sources, now)
    await _shared(session, room_id, "round")
    return await _answer(session, room_id, write, locale)


def _retro_module(write: _Write, module_id: uuid.UUID | None, locale: str) -> Module:
    """A Retro module of the open round: `module_id`, or its first one when
    `None`. 404 for no such module; 422 for another kind's or a closed
    round's (a closed round's columns are read-only, Decision 16)."""
    chain = write.board.chain(write.board.open_round.id)
    retro = [module for module in chain if module.kind is ModuleKind.RETRO]
    if module_id is None:
        if not retro:
            raise WrongBoardError("errors.sessionZero.notRetroColumn")
        return retro[0]
    module = _module_or_404(write, module_id, locale)
    if module not in retro:
        raise WrongBoardError("errors.sessionZero.notRetroColumn")
    return module


def _module_or_404(write: _Write, module_id: uuid.UUID, locale: str) -> Module:
    module = next((m for m in write.board.modules if m.id == module_id), None)
    if module is None or module.id in write.hidden:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.sessionZero.moduleNotFound", locale)
    return module


def _open_module(write: _Write, module_id: uuid.UUID, locale: str) -> Module:
    """A module of the open round, the Master's to change (409 for a closed
    round's)."""
    module = _module_or_404(write, module_id, locale)
    ensure_round_open(next(r for r in write.board.rounds if r.id == module.round_id))
    return module


@router.post("/modules")
async def add_module(
    room_id: uuid.UUID,
    body: ModuleBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 3: the Master adds a module at the end of the open
    session's chain, empty (a Retro one with the preset columns) unless it
    carries an earlier session's content over (spec 47b)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    open_round = write.board.open_round
    chain = write.board.chain(open_round.id)
    try:
        ensure_master(write.viewer.role)
        ensure_can_add_module(open_round, len(chain))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    index = sum(1 for module in chain if module.kind is body.kind)
    source = (
        carry_source(_earlier_chains(write, include_open=False), body.kind, index)
        if body.carry
        else None
    )
    now = datetime.now(UTC)
    module_id = await session_zero_repo.add_module(
        session,
        room_id,
        open_round.id,
        (body.kind, _carried_columns(write, source, _preset_columns(locale))),
        max(module.position for module in chain) + 1,
        now,
    )
    await _set_up_modules(session, room_id, open_round.id, [source], now, only=module_id)
    await _shared(session, room_id, "module", module_id)
    return await _answer(session, room_id, write, locale)


@router.delete("/modules/{module_id}")
async def remove_module(
    room_id: uuid.UUID,
    module_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 3: the Master removes a module of the open session,
    with its columns and post-its (the client asks first; Lines & Veils'
    board is the Room's and stays). The chain keeps one at least. When it
    was the current step, the table moves to the one before it."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    open_round = write.board.open_round
    chain = write.board.chain(open_round.id)
    try:
        ensure_master(write.viewer.role)
        module = _open_module(write, module_id, locale)
        ensure_can_remove_module(open_round, len(chain))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    current = current_after_removal(chain, module.id, open_round.current_module_id)
    await session_zero_repo.delete_module(session, module.id)
    await session_zero_repo.set_module_positions(
        session, [m.id for m in chain if m.id != module.id]
    )
    await session_zero_repo.set_current_module(session, open_round.id, current)
    await _shared(session, room_id, "module", module.id)
    return await _answer(session, room_id, write, locale)


@router.put("/modules/order")
async def reorder_modules(
    room_id: uuid.UUID,
    body: ModuleOrderBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 3: the Master reorders the open session's chain. The
    list must name each module exactly once (422 otherwise). The table stays
    on the same step, wherever it now stands."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    try:
        ensure_master(write.viewer.role)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    current = {m.id for m in write.board.chain(write.board.open_round.id)}
    if len(body.module_ids) != len(current) or set(body.module_ids) != current:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.moduleOrder", locale
        )
    await session_zero_repo.set_module_positions(session, body.module_ids)
    await _shared(session, room_id, "module")
    return await _answer(session, room_id, write, locale)


@router.put("/modules/current")
async def set_current_module(
    room_id: uuid.UUID,
    body: CurrentModuleBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 47 Decision 4: the Master moves the table to a step of the open
    session ("Avanti" is the next one); every open page follows."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    open_round = write.board.open_round
    try:
        ensure_master(write.viewer.role)
        module = _open_module(write, body.module_id, locale)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if module.id != open_round.current_module_id:
        await session_zero_repo.set_current_module(session, open_round.id, module.id)
        await _shared(session, room_id, "module", module.id)
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
    Retro column of the open round; a Player their own, into groups holding
    only theirs (spec 46d Q2). Post-its already grouped bring their groups
    along: everything lands in the first post-it's group, after the post-its
    it holds, or in a new one where the first post-it stood (spec 46d
    Decision 7, the post-it dropped on first), and the groups left empty
    go."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card_ids = list(dict.fromkeys(body.card_ids))
    found = [await _card_or_404(session, write, card_id, locale) for card_id in card_ids]
    cards = [card for card, _ in found]
    column = found[0][1] if found else None
    existing = list(dict.fromkeys(c.group_id for c in cards if c.group_id is not None))
    members = await session_zero_repo.list_group_cards(session, existing)
    try:
        if column is None:
            raise NotGroupableError("errors.sessionZero.notGroupable")
        ensure_can_group(
            cards,
            column,
            write.board.round_of(column),
            write.viewer.user_id,
            write.viewer.role,
            members,
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    assert column is not None
    if existing:
        target, merged = existing[0], existing[1:]
        await session_zero_repo.delete_groups(session, merged)
    else:
        target = await session_zero_repo.add_group(
            session, room_id, column.id, cards[0].position, datetime.now(UTC)
        )
    # The first group's post-its first, then the merged groups', then the rest.
    by_group = sorted(members, key=lambda card: existing.index(card.group_id))  # type: ignore[arg-type]
    order = list(dict.fromkeys([*(card.id for card in by_group), *card_ids]))
    await session_zero_repo.set_group(session, order, target)
    await session_zero_repo.set_order(session, order)
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
    """Spec 46c Decision 9: the Master dissolves a group; its post-its stay,
    where the group stood (spec 46d Decision 7)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    group, column = await _group_or_404(session, write, group_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_round_open(write.board.round_of(column))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    items = await session_zero_repo.column_order(session, column.id)
    members = [card.id for card in await session_zero_repo.list_group_cards(session, [group.id])]
    order: list[uuid.UUID] = []
    for item, _ in items:
        order.extend(members if item == group.id else [item])
    await session_zero_repo.delete_groups(session, [group.id])
    await session_zero_repo.set_order(
        session, order, {item for item, is_group in items if is_group}
    )
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
    """Spec 46c Decision 9: the Master takes a post-it out of its group,
    just after it (spec 46d Decision 7); a group left with one post-it
    dissolves. A post-it in no group changes nothing."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    try:
        ensure_master(write.viewer.role)
        ensure_round_open(write.board.round_of(column))
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if card.group_id is not None:
        items = await session_zero_repo.column_order(session, column.id)
        ids = [item for item, _ in items]
        after = ids.index(card.group_id) + 1
        before = ids[after] if after < len(ids) else None
        await session_zero_repo.set_group(session, [card.id], None)
        await session_zero_repo.set_order(
            session,
            placed(ids, card.id, before),
            {item for item, is_group in items if is_group},
        )
        await session_zero_repo.prune_groups(session, column.id)
        await _shared(session, room_id, "group", card.group_id)
    return await _answer(session, room_id, write, locale)


@router.put("/cards/{card_id}/place")
async def place_card(
    room_id: uuid.UUID,
    card_id: uuid.UUID,
    body: PlaceBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46d Decision 7: a dragged post-it lands in `column_id` (its own
    or another of its board and round), in `group_id` or in none, before
    `before_id` or last. The Master moves any, a Player their own, drafts
    included; joining or leaving a group holding someone else's post-its
    is the Master's (Q2). A group left with one post-it dissolves. On Lines
    & Veils the Master orders and moves (Decision 16)."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    card, column = await _card_or_404(session, write, card_id, locale)
    target = _column_or_404(write, body.column_id, locale)
    group: Group | None = None
    if body.group_id is not None:
        group, group_column = await _group_or_404(session, write, body.group_id, locale)
        if group_column.id != target.id:
            raise http_error(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.sessionZero.badPlace", locale
            )
    regrouped = body.group_id != card.group_id
    left_or_joined = [g for g in (card.group_id, body.group_id) if regrouped and g is not None]
    mates = [
        mate
        for mate in await session_zero_repo.list_group_cards(session, left_or_joined)
        if mate.id != card.id
    ]
    try:
        ensure_can_place_card(
            card,
            column,
            target,
            write.board.round_of(column),
            write.viewer.user_id,
            write.viewer.role,
            into_group=group is not None,
            mates=mates,
            sources_in_target=await session_zero_repo.list_sources_in_column(session, target.id),
        )
        if group is not None:
            members = await session_zero_repo.list_group_cards(session, [group.id])
            order = placed([m.id for m in members], card.id, body.before_id)
            groups: set[uuid.UUID] = set()
        else:
            items = await session_zero_repo.column_order(session, target.id)
            hidden = await session_zero_repo.list_hidden_drafts(
                session, target.id, write.viewer.user_id
            )
            order = placed([item for item, _ in items], card.id, body.before_id, hidden)
            groups = {item for item, is_group in items if is_group}
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await session_zero_repo.update_card(
        session, card.id, datetime.now(UTC), column_id=target.id, group_id=body.group_id
    )
    await session_zero_repo.set_order(session, order, groups)
    if regrouped and card.group_id is not None:
        await session_zero_repo.prune_groups(session, column.id)
    if card.is_draft:
        _private(session, write, card.id)
    else:
        await _shared(session, room_id, "card", card.id)
    return await _answer(session, room_id, write, locale)


@router.put("/groups/{group_id}/place")
async def place_group(
    room_id: uuid.UUID,
    group_id: uuid.UUID,
    body: PlaceBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SessionZeroResponse:
    """Spec 46d Decision 7: the Master drags a group, its post-its with it,
    within its column or into another Retro column of the open round,
    before `before_id` (a post-it in no group, or a group) or last."""
    write = await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    group, column = await _group_or_404(session, write, group_id, locale)
    target = _column_or_404(write, body.column_id, locale)
    try:
        ensure_can_place_group(column, target, write.board.round_of(column), write.viewer.role)
        items = await session_zero_repo.column_order(session, target.id)
        hidden = await session_zero_repo.list_hidden_drafts(
            session, target.id, write.viewer.user_id
        )
        order = placed([item for item, _ in items], group.id, body.before_id, hidden)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    if target.id != column.id:
        await session_zero_repo.move_group(session, group.id, target.id)
    await session_zero_repo.set_order(
        session, order, {group.id, *(item for item, is_group in items if is_group)}
    )
    await _shared(session, room_id, "group", group.id)
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


@router.get("/events")
async def session_zero_events(
    room_id: uuid.UUID,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    locale: LocaleDep,
) -> StreamingResponse:
    """Spec 46_2, kept by spec 52 Decision 2 for tabs opened before the Room
    stream: the Room stream (`GET /rooms/{id}/events`) with its Session 0
    events only."""
    return await open_room_stream(room_id, credentials, locale, frozenset({SESSION_ZERO}))

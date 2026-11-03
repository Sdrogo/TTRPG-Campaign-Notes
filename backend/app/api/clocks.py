"""Clocks (spec 61): a Room's progress clocks, its clock rules, labels, mark
kinds and templates. Members only (403); a clock hidden from the requester
is 404, checked before any permission (Decision 15). Every read shows the
clocks as the requester sees them, without the Master's consequence for a
Player (Decision 14), and follows `X-View-As` like any read."""

import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import ensure_room_members, require_membership, visible_documents
from app.api.errors import http_error, translated_error
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import clocks_repo, documents_repo, room_sections_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.clocks import (
    HISTORY_PAGE_SIZE,
    MAX_CLOCKS_PER_DOCUMENT,
    MAX_CLOCKS_PER_ROOM,
    MAX_LABEL_NAME_LENGTH,
    MAX_LABELS_PER_ROOM,
    MAX_MARK_KINDS,
    MAX_NOTE_LENGTH,
    MAX_SEGMENTS,
    MAX_TEMPLATES_PER_ROOM,
    Clock,
    ClockEvent,
    ClockFieldError,
    ClockGroup,
    ClockLabel,
    ClockLimitError,
    ClockMark,
    ClockNameTakenError,
    ClockNotMarkableError,
    ClockRules,
    ClockSettings,
    ClockState,
    ClockTemplate,
    HistoryAction,
    KindWho,
    MarkKind,
    MarkKindNotAllowedError,
    MarkPolicy,
    MasterOnlyFieldError,
    OpenPolicy,
    StaleClockError,
    UndoExpiredError,
    UndoNotAllowedError,
    UnknownClockItemError,
    UnmarkNotAllowedError,
    apply_mark,
    can_manage_clock,
    can_mark_clock,
    can_unmark,
    choose_kind,
    clean_line,
    clean_name,
    clean_settings,
    clock_visibility_audit,
    creation_state,
    edited_fields,
    ensure_base_revision,
    ensure_below,
    ensure_known,
    ensure_name_free,
    ensure_settings_allowed,
    is_clock_visible,
    is_locked,
    resized,
    segment_kinds,
    undo_mark,
    visible_clock,
    visible_event,
    visible_template,
)
from app.domain.errors import DomainError
from app.domain.models import DocumentVisibility, Membership, RoomRole
from app.domain.relationship_maps import MapColor
from app.domain.room_sections import SectionKind, TooManySectionsError, plan_new_section
from app.domain.rooms import starting_visibility
from app.domain.visibility import starting_grants
from app.i18n.dependencies import LocaleDep
from app.realtime.audience import CHANGED, DELETED, MARKED, clock_audience, push, push_clock
from app.realtime.broker import CLOCK_RULES, LANDING, Event

router = APIRouter(prefix="/rooms/{room_id}", tags=["clocks"])

# Which status each domain error answers with.
_ERROR_STATUS: dict[type[DomainError], int] = {
    ClockFieldError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    UnknownClockItemError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    ClockLimitError: status.HTTP_409_CONFLICT,
    ClockNameTakenError: status.HTTP_409_CONFLICT,
    ClockNotMarkableError: status.HTTP_409_CONFLICT,
    UndoExpiredError: status.HTTP_409_CONFLICT,
    UnmarkNotAllowedError: status.HTTP_403_FORBIDDEN,
    MarkKindNotAllowedError: status.HTTP_403_FORBIDDEN,
    UndoNotAllowedError: status.HTTP_403_FORBIDDEN,
    MasterOnlyFieldError: status.HTTP_403_FORBIDDEN,
    StaleClockError: status.HTTP_412_PRECONDITION_FAILED,
}
_ERRORS = tuple(_ERROR_STATUS)


def _fail(exc: DomainError, locale: str) -> Exception:
    """The HTTP error for a domain error of this module."""
    return translated_error(_ERROR_STATUS[type(exc)], exc, locale)


def _now() -> datetime:
    """The current time, in UTC."""
    return datetime.now(UTC)


# --- Schemas ------------------------------------------------------------------


class LabelResponse(BaseModel):
    """A label. `clock_count` (the Master's only) says on how many clocks a
    deletion would remove it."""

    id: uuid.UUID
    name: str
    color: MapColor
    position: int
    clock_count: int | None = None


class MarkKindResponse(BaseModel):
    """A mark kind."""

    id: uuid.UUID
    name: str
    color: MapColor
    who: KindWho
    position: int


class SettingsBody(BaseModel):
    """A clock's settings as a template keeps them (Decision 3)."""

    description: str = ""
    segments: int = 6
    color: MapColor = MapColor.DEFAULT
    stage_labels: list[str] = Field(default=[], max_length=MAX_SEGMENTS)
    closing_condition: str | None = None
    consequence: str | None = None
    forward_only: bool = False
    mark_policy: MarkPolicy | None = None
    label_ids: UniqueIds = []


class TemplateResponse(BaseModel):
    """A Room template; `settings.consequence` is the Master's only."""

    id: uuid.UUID
    name: str
    position: int
    settings: SettingsBody


class RulesResponse(BaseModel):
    """The Room's clock setup: rules, labels, mark kinds, templates."""

    open_policy: OpenPolicy
    mark_policy: MarkPolicy
    allow_unmark: bool
    labels: list[LabelResponse]
    mark_kinds: list[MarkKindResponse]
    templates: list[TemplateResponse]


class RulesRequest(BaseModel):
    """The three policies (a preset fills them on the client, Decision 2)."""

    open_policy: OpenPolicy
    mark_policy: MarkPolicy
    allow_unmark: bool


class LabelRequest(BaseModel):
    """A new label."""

    name: str
    color: MapColor = MapColor.DEFAULT


class LabelUpdateRequest(BaseModel):
    """A label's new name or colour."""

    name: str | None = None
    color: MapColor | None = None


class KindRequest(BaseModel):
    """A new mark kind."""

    name: str
    color: MapColor = MapColor.DEFAULT
    who: KindWho = KindWho.EVERYONE


class KindUpdateRequest(BaseModel):
    """A mark kind's new name, colour or users."""

    name: str | None = None
    color: MapColor | None = None
    who: KindWho | None = None


class OrderRequest(BaseModel):
    """Every item of its list, once, in the new order."""

    ids: UniqueIds


class TemplateRequest(BaseModel):
    """A new template: a name and the settings."""

    name: str
    settings: SettingsBody


class TemplateUpdateRequest(BaseModel):
    """A template's new name or settings."""

    name: str | None = None
    settings: SettingsBody | None = None


class LinkedDocumentResponse(BaseModel):
    """The linked Document, when the requester sees it (Decision 19)."""

    id: uuid.UUID
    name: str


class ClockResponse(BaseModel):
    """A clock as the requester sees it. `segment_kinds` is the mark kind of
    each filled segment (None: the clock's colour). `consequence` is the
    Master's only; `selective_user_ids` is sent only to who manages the
    clock. `can_mark` says whether they may mark it now (its state and a
    sequence's lock included), `can_unmark` whether segments can be
    emptied; `revision` is what an edit sends back as `base_revision`."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    segments: int
    filled: int
    color: MapColor
    stage_labels: list[str]
    closing_condition: str | None
    consequence: str | None
    forward_only: bool
    mark_policy: MarkPolicy | None
    state: ClockState
    archived: bool
    group_id: uuid.UUID | None
    group_position: int | None
    decisive_label: str | None
    document: LinkedDocumentResponse | None
    label_ids: list[uuid.UUID]
    segment_kinds: list[uuid.UUID | None]
    visibility: DocumentVisibility
    selective_user_ids: list[uuid.UUID] | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    revision: int
    locked: bool
    can_manage: bool
    can_mark: bool
    can_unmark: bool


class CreateClockRequest(SettingsBody):
    """A new clock. Without `visibility` it starts at the Room's default
    (VR-05). A Player's is a proposal under "I giocatori propongono"."""

    name: str
    document_id: uuid.UUID | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds = []


class UpdateClockRequest(BaseModel):
    """A partial update: omitted fields stay. `document_id` and the
    nullable texts are cleared by sending `clear`'s names. `base_revision`
    is the revision the dialog was loaded at (412 when it moved on)."""

    base_revision: int | None = None
    name: str | None = None
    description: str | None = None
    segments: int | None = None
    color: MapColor | None = None
    stage_labels: list[str] | None = Field(default=None, max_length=MAX_SEGMENTS)
    closing_condition: str | None = None
    consequence: str | None = None
    forward_only: bool | None = None
    mark_policy: MarkPolicy | None = None
    label_ids: UniqueIds | None = None
    document_id: uuid.UUID | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds | None = None
    archived: bool | None = None
    clear: list[str] = []


class MarkRequest(BaseModel):
    """A mark (Decision 9): `delta` segments, negative to empty; `kind_id`
    defaults to the marker's first allowed kind."""

    delta: int = Field(ge=-MAX_SEGMENTS, le=MAX_SEGMENTS)
    kind_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=MAX_NOTE_LENGTH * 2)


class MarkResponse(BaseModel):
    """The clock after a mark or an undo, and the mark (for "Annulla")."""

    clock: ClockResponse
    mark_id: uuid.UUID


class HistoryEntry(BaseModel):
    """A line of a clock's history (Decision 10)."""

    id: uuid.UUID
    user_id: uuid.UUID | None
    action: HistoryAction
    details: dict[str, object]
    created_at: datetime


class HistoryResponse(BaseModel):
    """A page of history, newest first; `next_before` asks for the next."""

    entries: list[HistoryEntry]
    next_before: datetime | None


# The nullable fields `UpdateClockRequest.clear` may name.
_CLEARABLE = frozenset({"closing_condition", "consequence", "mark_policy", "document_id"})


# --- Shared -------------------------------------------------------------------


def _ensure_master(membership: Membership, locale: str) -> None:
    """403 unless the requester is the Master."""
    if membership.role != RoomRole.MASTER:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.clock.onlyMaster", locale)


def _settings_body(settings: ClockSettings) -> SettingsBody:
    """Settings as returned."""
    return SettingsBody(
        description=settings.description,
        segments=settings.segments,
        color=settings.color,
        stage_labels=list(settings.stage_labels),
        closing_condition=settings.closing_condition,
        consequence=settings.consequence,
        forward_only=settings.forward_only,
        mark_policy=settings.mark_policy,
        label_ids=list(settings.label_ids),
    )


def _clean(body: SettingsBody, locale: str) -> ClockSettings:
    """The sent settings, cleaned (422 otherwise)."""
    try:
        return clean_settings(
            description=body.description,
            segments=body.segments,
            color=body.color,
            stage_labels=body.stage_labels,
            closing_condition=body.closing_condition,
            consequence=body.consequence,
            forward_only=body.forward_only,
            mark_policy=body.mark_policy,
            label_ids=body.label_ids,
        )
    except ClockFieldError as exc:
        raise _fail(exc, locale) from exc


async def _ensure_labels(
    session: AsyncSession, room_id: uuid.UUID, label_ids: Collection[uuid.UUID], locale: str
) -> None:
    """422 unless every label is the Room's: Players choose among them only."""
    labels = await clocks_repo.list_labels(session, room_id)
    try:
        ensure_known(label_ids, {label.id for label in labels}, "errors.clock.unknownLabel")
    except UnknownClockItemError as exc:
        raise _fail(exc, locale) from exc


async def rules_response(
    session: AsyncSession, room_id: uuid.UUID, viewer: Membership
) -> RulesResponse:
    """The Room's clock setup as `viewer` reads it."""
    rules = await clocks_repo.get_rules(session, room_id)
    labels = await clocks_repo.list_labels(session, room_id)
    is_master = viewer.role == RoomRole.MASTER
    uses = await clocks_repo.count_label_uses(session, room_id) if is_master else {}
    return RulesResponse(
        open_policy=rules.open_policy,
        mark_policy=rules.mark_policy,
        allow_unmark=rules.allow_unmark,
        labels=[
            LabelResponse(
                id=label.id,
                name=label.name,
                color=label.color,
                position=label.position,
                clock_count=uses.get(label.id, 0) if is_master else None,
            )
            for label in labels
        ],
        mark_kinds=[
            MarkKindResponse(
                id=kind.id, name=kind.name, color=kind.color, who=kind.who, position=kind.position
            )
            for kind in await clocks_repo.list_kinds(session, room_id)
        ],
        templates=[
            TemplateResponse(
                id=template.id,
                name=template.name,
                position=template.position,
                settings=_settings_body(template.settings),
            )
            for template in (
                visible_template(t, viewer.role)
                for t in await clocks_repo.list_templates(session, room_id)
            )
        ],
    )


def _push_rules(session: AsyncSession, room_id: uuid.UUID) -> None:
    """Tells the whole Room its clock setup changed (Decision 22); the
    clocks may read differently too (a label gone, who marks)."""
    push(session, room_id, Event(None, CHANGED, None, CLOCK_RULES))


@dataclass(frozen=True)
class _View:
    """What a batch of clock responses needs, read once: the rules, the
    clocks' grants and live marks, their groups with every clock of those
    groups (a sequence's lock), and the linked Documents the viewer sees."""

    rules: ClockRules
    grants: Mapping[uuid.UUID, list[uuid.UUID]]
    marks: Mapping[uuid.UUID, list[ClockMark]]
    groups: Mapping[uuid.UUID, ClockGroup]
    group_clocks: Mapping[uuid.UUID, list[Clock]]
    documents: Mapping[uuid.UUID, str]


async def _view(
    session: AsyncSession, room_id: uuid.UUID, clocks: Sequence[Clock], viewer: Membership
) -> _View:
    """Reads `_View` for these clocks in a fixed number of queries."""
    ids = [clock.id for clock in clocks]
    group_ids = {clock.group_id for clock in clocks if clock.group_id is not None}
    groups: dict[uuid.UUID, ClockGroup] = {}
    group_clocks: dict[uuid.UUID, list[Clock]] = {}
    if group_ids:
        groups = {
            group.id: group
            for group in await clocks_repo.list_groups(session, room_id)
            if group.id in group_ids
        }
        for clock in await clocks_repo.list_clocks(session, room_id):
            if clock.group_id in group_ids:
                group_clocks.setdefault(clock.group_id, []).append(clock)
    linked = [clock.document_id for clock in clocks if clock.document_id is not None]
    documents = await documents_repo.get_documents_by_ids(session, list(set(linked)))
    return _View(
        rules=await clocks_repo.get_rules(session, room_id),
        grants=await clocks_repo.list_grants(session, ids),
        marks=await clocks_repo.list_live_marks(session, ids),
        groups=groups,
        group_clocks=group_clocks,
        documents={d.id: d.name for d in await visible_documents(session, documents, viewer)},
    )


def _locked(clock: Clock, view: _View) -> bool:
    """Whether the clock waits behind an earlier one of its sequence."""
    if clock.group_id is None:
        return False
    return is_locked(
        clock, view.groups.get(clock.group_id), view.group_clocks.get(clock.group_id, [])
    )


def _response(clock: Clock, view: _View, viewer: Membership) -> ClockResponse:
    """One clock as `viewer` sees it."""
    shown = visible_clock(clock, viewer.role)
    can_manage = can_manage_clock(clock, viewer.user_id, viewer.role)
    locked = _locked(clock, view)
    markable = (
        clock.state in (ClockState.OPEN, ClockState.CLOSED)
        and clock.archived_at is None
        and not locked
    )
    document = None
    if clock.document_id is not None and clock.document_id in view.documents:
        document = LinkedDocumentResponse(
            id=clock.document_id, name=view.documents[clock.document_id]
        )
    return ClockResponse(
        id=shown.id,
        room_id=shown.room_id,
        name=shown.name,
        description=shown.description,
        segments=shown.segments,
        filled=shown.filled,
        color=shown.color,
        stage_labels=list(shown.stage_labels),
        closing_condition=shown.closing_condition,
        consequence=shown.consequence,
        forward_only=shown.forward_only,
        mark_policy=shown.mark_policy,
        state=shown.state,
        archived=shown.archived_at is not None,
        group_id=shown.group_id,
        group_position=shown.group_position,
        decisive_label=shown.decisive_label,
        document=document,
        label_ids=list(shown.label_ids),
        segment_kinds=segment_kinds(view.marks.get(clock.id, []), clock.filled),
        visibility=shown.visibility,
        selective_user_ids=sorted(view.grants.get(clock.id, [])) if can_manage else None,
        created_by=shown.created_by,
        created_at=shown.created_at,
        updated_at=shown.updated_at,
        revision=shown.revision,
        locked=locked,
        can_manage=can_manage,
        can_mark=markable and can_mark_clock(clock, view.rules, viewer.user_id, viewer.role),
        can_unmark=can_unmark(clock, view.rules),
    )


async def clock_responses(
    session: AsyncSession, room_id: uuid.UUID, clocks: Sequence[Clock], viewer: Membership
) -> list[ClockResponse]:
    """These clocks (already filtered for `viewer`) as they see them."""
    view = await _view(session, room_id, clocks, viewer)
    return [_response(clock, view, viewer) for clock in clocks]


async def _one(session: AsyncSession, clock: Clock, viewer: Membership) -> ClockResponse:
    """One clock as `viewer` sees it."""
    return (await clock_responses(session, clock.room_id, [clock], viewer))[0]


async def visible_clocks(
    session: AsyncSession, room_id: uuid.UUID, viewer: Membership
) -> list[Clock]:
    """The Room's clocks `viewer` sees, in the Clocks page's order."""
    clocks = await clocks_repo.list_clocks(session, room_id)
    grants = await clocks_repo.list_grants(session, [clock.id for clock in clocks])
    return [
        clock
        for clock in clocks
        if is_clock_visible(clock, viewer.user_id, viewer.role, grants[clock.id])
    ]


async def visible_chip_targets(
    session: AsyncSession, room_id: uuid.UUID, viewer: Membership
) -> tuple[set[uuid.UUID], set[uuid.UUID]]:
    """The clocks and groups a Clocks block may name to `viewer` (Decision
    18): the clocks they see, and the groups holding one of them (the
    Master: every group)."""
    clocks = await visible_clocks(session, room_id, viewer)
    if viewer.role == RoomRole.MASTER:
        groups = {group.id for group in await clocks_repo.list_groups(session, room_id)}
    else:
        groups = {clock.group_id for clock in clocks if clock.group_id is not None}
    return {clock.id for clock in clocks}, groups


async def ensure_page_card(session: AsyncSession, room_id: uuid.UUID) -> None:
    """Decision 17: the Clocks page card joins the Room home the first time
    the Room's clocks are used, unless it is there already or the home is
    full. The caller calls it only on a first use, so a card the Master
    removed stays removed."""
    sections = await room_sections_repo.list_sections(session, room_id)
    if any(section.kind is SectionKind.PAGE_CLOCKS for section in sections):
        return
    try:
        card = plan_new_section(room_id, sections, SectionKind.PAGE_CLOCKS, None)
    except TooManySectionsError:
        return
    await room_sections_repo.insert_sections(session, [card])
    push(session, room_id, Event(None, CHANGED, None, LANDING))


async def get_visible_clock(
    session: AsyncSession,
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    viewer: Membership,
    locale: str,
    *,
    lock: bool = False,
) -> tuple[Clock, list[uuid.UUID]]:
    """The clock and its grants once the viewer is known to see it; 404
    otherwise. With `lock`, re-read under its row lock."""
    clock = await clocks_repo.get_clock(session, clock_id)
    if clock is None or clock.room_id != room_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.notFound", locale)
    grants = (await clocks_repo.list_grants(session, [clock_id]))[clock_id]
    if not is_clock_visible(clock, viewer.user_id, viewer.role, grants):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.notFound", locale)
    if lock:
        locked = await clocks_repo.lock_clock(session, clock_id)
        if locked is None:  # pragma: no cover - only a concurrent deletion
            raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.notFound", locale)
        clock = locked
    return clock, grants


async def _managed_clock(
    session: AsyncSession, room_id: uuid.UUID, clock_id: uuid.UUID, viewer: Membership, locale: str
) -> tuple[Clock, list[uuid.UUID]]:
    """`get_visible_clock` under its lock, then 403 unless the viewer manages
    it (Decision 14)."""
    clock, grants = await get_visible_clock(session, room_id, clock_id, viewer, locale, lock=True)
    if not can_manage_clock(clock, viewer.user_id, viewer.role):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.clock.notManager", locale)
    return clock, grants


async def _check_document(
    session: AsyncSession,
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    viewer: Membership,
    clock_id: uuid.UUID | None,
    locale: str,
) -> None:
    """422 unless the linked Document is the Room's and seen by the editor;
    409 when it already has `MAX_CLOCKS_PER_DOCUMENT` clocks (Decision 31)."""
    documents = await documents_repo.get_documents_by_ids(session, [document_id])
    shown = await visible_documents(session, documents, viewer)
    if not shown or shown[0].room_id != room_id:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.unknownDocument", locale
        )
    try:
        ensure_below(
            await clocks_repo.count_clocks_for_document(session, document_id, clock_id),
            MAX_CLOCKS_PER_DOCUMENT,
            "errors.clock.tooManyForDocument",
        )
    except ClockLimitError as exc:
        raise _fail(exc, locale) from exc


async def _record(
    session: AsyncSession,
    clock: Clock,
    user_id: uuid.UUID | None,
    action: HistoryAction,
    **details: object,
) -> None:
    """Writes a line of the clock's history."""
    await clocks_repo.insert_event(
        session,
        ClockEvent(
            id=uuid.uuid4(),
            clock_id=clock.id,
            user_id=user_id,
            action=action,
            details=dict(details),
            created_at=_now(),
        ),
    )


async def record_state_change(
    session: AsyncSession, before: Clock, after: Clock, user_id: uuid.UUID | None
) -> None:
    """The history line of a mark or undo that closed or reopened a clock."""
    if before.state != ClockState.CLOSED and after.state == ClockState.CLOSED:
        await _record(session, after, user_id, HistoryAction.CLOSED)
    elif before.state == ClockState.CLOSED and after.state == ClockState.OPEN:
        await _record(session, after, user_id, HistoryAction.REOPENED)


# --- Rules, labels, mark kinds, templates -------------------------------------


@router.get("/clock-rules")
async def get_clock_rules(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> RulesResponse:
    """Decisions 1-3: the Room's clock rules, labels, mark kinds and
    templates, for every member."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    return await rules_response(session, room_id, membership)


@router.put("/clock-rules")
async def save_clock_rules(
    room_id: uuid.UUID,
    body: RulesRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RulesResponse:
    """Decision 1: the Master sets who opens, who marks and whether marks
    can be undone. Existing clocks keep their values (Decision 2)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    if not await clocks_repo.has_rules(session, room_id):
        await ensure_page_card(session, room_id)
    await clocks_repo.save_rules(
        session,
        ClockRules(
            room_id=room_id,
            open_policy=body.open_policy,
            mark_policy=body.mark_policy,
            allow_unmark=body.allow_unmark,
        ),
        _now(),
    )
    _push_rules(session, room_id)
    return await rules_response(session, room_id, membership)


@router.post("/clock-rules/labels", status_code=status.HTTP_201_CREATED)
async def create_label(
    room_id: uuid.UUID,
    body: LabelRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> LabelResponse:
    """Decision 1: the Master adds a label (from a clock's picker, "Crea
    «…»", or the rules dialog); its name is unique in the Room whatever
    the case (409), up to 100 labels."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    labels = await clocks_repo.list_labels(session, room_id)
    try:
        name = clean_name(body.name, MAX_LABEL_NAME_LENGTH, "labelName")
        ensure_below(len(labels), MAX_LABELS_PER_ROOM, "errors.clock.tooManyRoomLabels")
        ensure_name_free(name, (label.name for label in labels), "errors.clock.labelExists")
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    label = ClockLabel(
        id=uuid.uuid4(), room_id=room_id, name=name, color=body.color, position=len(labels)
    )
    await clocks_repo.save_label(session, label)
    _push_rules(session, room_id)
    return LabelResponse(
        id=label.id, name=label.name, color=label.color, position=label.position, clock_count=0
    )


async def _label(
    session: AsyncSession, room_id: uuid.UUID, label_id: uuid.UUID, locale: str
) -> tuple[ClockLabel, list[ClockLabel]]:
    """The label and the Room's others; 404 when it isn't the Room's."""
    labels = await clocks_repo.list_labels(session, room_id)
    label = next((label for label in labels if label.id == label_id), None)
    if label is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.labelNotFound", locale)
    return label, [other for other in labels if other.id != label_id]


@router.patch("/clock-rules/labels/{label_id}")
async def update_label(
    room_id: uuid.UUID,
    label_id: uuid.UUID,
    body: LabelUpdateRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> LabelResponse:
    """The Master renames or recolours a label (its clocks follow)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    label, others = await _label(session, room_id, label_id, locale)
    try:
        name = label.name
        if body.name is not None:
            name = clean_name(body.name, MAX_LABEL_NAME_LENGTH, "labelName")
            ensure_name_free(name, (other.name for other in others), "errors.clock.labelExists")
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    updated = replace(label, name=name, color=body.color or label.color)
    await clocks_repo.save_label(session, updated)
    _push_rules(session, room_id)
    uses = await clocks_repo.count_label_uses(session, room_id)
    return LabelResponse(
        id=updated.id,
        name=updated.name,
        color=updated.color,
        position=updated.position,
        clock_count=uses.get(updated.id, 0),
    )


@router.delete("/clock-rules/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_label(
    room_id: uuid.UUID,
    label_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """The Master deletes a label; its clocks lose it (the client asks
    first, with `clock_count`)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await _label(session, room_id, label_id, locale)
    await clocks_repo.delete_label(session, label_id)
    _push_rules(session, room_id)


@router.put("/clock-rules/labels-order")
async def reorder_labels(
    room_id: uuid.UUID,
    body: OrderRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RulesResponse:
    """The Master orders the labels: every one of them, once (422)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    labels = {label.id: label for label in await clocks_repo.list_labels(session, room_id)}
    if set(body.ids) != set(labels):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.orderMismatch", locale
        )
    for position, label_id in enumerate(body.ids):
        await clocks_repo.save_label(session, replace(labels[label_id], position=position))
    _push_rules(session, room_id)
    return await rules_response(session, room_id, membership)


@router.post("/clock-rules/mark-kinds", status_code=status.HTTP_201_CREATED)
async def create_mark_kind(
    room_id: uuid.UUID,
    body: KindRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MarkKindResponse:
    """Decision 1: the Master adds a mark kind, up to 6, names unique."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    kinds = await clocks_repo.list_kinds(session, room_id)
    try:
        name = clean_name(body.name, MAX_LABEL_NAME_LENGTH, "kindName")
        ensure_below(len(kinds), MAX_MARK_KINDS, "errors.clock.tooManyKinds")
        ensure_name_free(name, (kind.name for kind in kinds), "errors.clock.kindExists")
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    kind = MarkKind(
        id=uuid.uuid4(),
        room_id=room_id,
        name=name,
        color=body.color,
        who=body.who,
        position=len(kinds),
    )
    await clocks_repo.save_kind(session, kind)
    _push_rules(session, room_id)
    return MarkKindResponse(
        id=kind.id, name=kind.name, color=kind.color, who=kind.who, position=kind.position
    )


async def _kind(
    session: AsyncSession, room_id: uuid.UUID, kind_id: uuid.UUID, locale: str
) -> tuple[MarkKind, list[MarkKind]]:
    """The mark kind and the Room's others; 404 when it isn't the Room's."""
    kinds = await clocks_repo.list_kinds(session, room_id)
    kind = next((kind for kind in kinds if kind.id == kind_id), None)
    if kind is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.kindNotFound", locale)
    return kind, [other for other in kinds if other.id != kind_id]


@router.patch("/clock-rules/mark-kinds/{kind_id}")
async def update_mark_kind(
    room_id: uuid.UUID,
    kind_id: uuid.UUID,
    body: KindUpdateRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MarkKindResponse:
    """The Master renames, recolours or changes who uses a mark kind."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    kind, others = await _kind(session, room_id, kind_id, locale)
    try:
        name = kind.name
        if body.name is not None:
            name = clean_name(body.name, MAX_LABEL_NAME_LENGTH, "kindName")
            ensure_name_free(name, (other.name for other in others), "errors.clock.kindExists")
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    updated = replace(kind, name=name, color=body.color or kind.color, who=body.who or kind.who)
    await clocks_repo.save_kind(session, updated)
    _push_rules(session, room_id)
    return MarkKindResponse(
        id=updated.id,
        name=updated.name,
        color=updated.color,
        who=updated.who,
        position=updated.position,
    )


@router.delete("/clock-rules/mark-kinds/{kind_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_mark_kind(
    room_id: uuid.UUID,
    kind_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """The Master deletes a mark kind; past marks of it turn neutral."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await _kind(session, room_id, kind_id, locale)
    await clocks_repo.delete_kind(session, kind_id)
    _push_rules(session, room_id)


@router.put("/clock-rules/mark-kinds-order")
async def reorder_mark_kinds(
    room_id: uuid.UUID,
    body: OrderRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> RulesResponse:
    """The Master orders the mark kinds (the first a member may use is their
    default, Decision 8): every one of them, once (422)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    kinds = {kind.id: kind for kind in await clocks_repo.list_kinds(session, room_id)}
    if set(body.ids) != set(kinds):
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.orderMismatch", locale
        )
    for position, kind_id in enumerate(body.ids):
        await clocks_repo.save_kind(session, replace(kinds[kind_id], position=position))
    _push_rules(session, room_id)
    return await rules_response(session, room_id, membership)


def _template_response(template: ClockTemplate) -> TemplateResponse:
    """A template as returned to the Master."""
    return TemplateResponse(
        id=template.id,
        name=template.name,
        position=template.position,
        settings=_settings_body(template.settings),
    )


@router.post("/clock-rules/templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    room_id: uuid.UUID,
    body: TemplateRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> TemplateResponse:
    """Decision 3: the Master saves a clock's settings as a template ("Salva
    come modello"), up to 20."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    templates = await clocks_repo.list_templates(session, room_id)
    settings = _clean(body.settings, locale)
    await _ensure_labels(session, room_id, settings.label_ids, locale)
    try:
        name = clean_name(body.name, field_key="templateName")
        ensure_below(len(templates), MAX_TEMPLATES_PER_ROOM, "errors.clock.tooManyTemplates")
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    template = ClockTemplate(
        id=uuid.uuid4(),
        room_id=room_id,
        name=name,
        settings=settings,
        position=max((t.position for t in templates), default=-1) + 1,
        created_at=_now(),
    )
    await clocks_repo.save_template(session, template)
    _push_rules(session, room_id)
    return _template_response(template)


@router.patch("/clock-rules/templates/{template_id}")
async def update_template(
    room_id: uuid.UUID,
    template_id: uuid.UUID,
    body: TemplateUpdateRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> TemplateResponse:
    """The Master renames a template or replaces its settings."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    templates = await clocks_repo.list_templates(session, room_id)
    template = next((t for t in templates if t.id == template_id), None)
    if template is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.templateNotFound", locale)
    settings = template.settings
    if body.settings is not None:
        settings = _clean(body.settings, locale)
        await _ensure_labels(session, room_id, settings.label_ids, locale)
    try:
        name = (
            template.name if body.name is None else clean_name(body.name, field_key="templateName")
        )
    except ClockFieldError as exc:
        raise _fail(exc, locale) from exc
    updated = replace(template, name=name, settings=settings)
    await clocks_repo.save_template(session, updated)
    _push_rules(session, room_id)
    return _template_response(updated)


@router.delete("/clock-rules/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    room_id: uuid.UUID,
    template_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """The Master deletes a template; clocks made from it stay."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    templates = await clocks_repo.list_templates(session, room_id)
    if not any(t.id == template_id for t in templates):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.templateNotFound", locale)
    await clocks_repo.delete_template(session, template_id)
    _push_rules(session, room_id)


# --- Clocks -------------------------------------------------------------------


@router.get("/clocks")
async def list_clocks(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[ClockResponse]:
    """Decision 17: the Room's clocks the requester sees, in the Master's
    order: open, closed, lapsed, archived and (the proposer's and the
    Master's) proposals; the client folds them."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clocks = await visible_clocks(session, room_id, membership)
    return await clock_responses(session, room_id, clocks, membership)


async def insert_clock(
    session: AsyncSession,
    room_id: uuid.UUID,
    membership: Membership,
    body: CreateClockRequest,
    locale: str,
) -> Clock:
    """Decisions 1, 4, 13: a new clock, open or (a Player's, under "I
    giocatori propongono") proposed. 403 when the member may not create
    one or sends the Master's consequence; 409 past the Room's 200."""
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    rules = await clocks_repo.get_rules(session, room_id)
    state = creation_state(membership.role, rules, room.players_can_create_documents)
    if state is None:
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.clock.creationDisabled", locale)
    settings = _clean(body, locale)
    try:
        name = clean_name(body.name)
        ensure_settings_allowed(membership.role, settings)
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    await _ensure_labels(session, room_id, settings.label_ids, locale)
    if body.document_id is not None:
        await _check_document(session, room_id, body.document_id, membership, None, locale)
    starting = starting_visibility(room, body.visibility)
    grants = starting_grants(starting, body.selective_user_ids)
    await ensure_room_members(
        session, room_id, grants, "errors.clock.invalidSelectiveUsers", locale
    )

    await rooms_repo.lock_room(session, room_id)
    count = await clocks_repo.count_clocks(session, room_id)
    try:
        ensure_below(count, MAX_CLOCKS_PER_ROOM, "errors.clock.tooManyClocks")
    except ClockLimitError as exc:
        raise _fail(exc, locale) from exc
    if count == 0 and not await clocks_repo.has_rules(session, room_id):
        await ensure_page_card(session, room_id)
    now = _now()
    clock = Clock(
        id=uuid.uuid4(),
        room_id=room_id,
        name=name,
        description=settings.description,
        segments=settings.segments,
        color=settings.color,
        stage_labels=settings.stage_labels,
        closing_condition=settings.closing_condition,
        consequence=settings.consequence,
        forward_only=settings.forward_only,
        mark_policy=settings.mark_policy,
        label_ids=settings.label_ids,
        state=state,
        document_id=body.document_id,
        position=await clocks_repo.next_position(session, room_id),
        visibility=starting,
        created_by=membership.user_id,
        created_at=now,
        updated_at=now,
    )
    await clocks_repo.insert_clock(session, clock, grants)
    action = HistoryAction.PROPOSED if state == ClockState.PROPOSED else HistoryAction.CREATED
    await _record(session, clock, membership.user_id, action)
    await push_clock(session, clock, grants)
    return clock


@router.post("/clocks", status_code=status.HTTP_201_CREATED)
async def create_clock(
    room_id: uuid.UUID,
    body: CreateClockRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ClockResponse:
    """Decisions 1, 4, 13: the Master opens a clock; a Player opens one or
    proposes it, as the rules say (403 otherwise)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clock = await insert_clock(session, room_id, membership, body, locale)
    return await _one(session, clock, membership)


@router.put("/clocks-order")
async def reorder_clocks(
    room_id: uuid.UUID,
    body: OrderRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[ClockResponse]:
    """Decision 17: the Master orders the Clocks page, sending every clock of
    the Room once (422 otherwise)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    await rooms_repo.lock_room(session, room_id)
    clocks = await clocks_repo.list_clocks(session, room_id)
    if set(body.ids) != {clock.id for clock in clocks}:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.orderMismatch", locale
        )
    await clocks_repo.set_positions(session, body.ids)
    _push_rules(session, room_id)
    return await clock_responses(
        session, room_id, await clocks_repo.list_clocks(session, room_id), membership
    )


@router.get("/clocks/{clock_id}")
async def get_clock(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ClockResponse:
    """One clock as the requester sees it; 404 when hidden from them."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clock, _ = await get_visible_clock(session, room_id, clock_id, membership, locale)
    return await _one(session, clock, membership)


def _edited(clock: Clock, body: UpdateClockRequest, locale: str) -> Clock:
    """The clock with the sent settings laid over it, cleaned (422)."""
    cleared = set(body.clear)
    if not cleared <= _CLEARABLE:
        raise http_error(status.HTTP_422_UNPROCESSABLE_CONTENT, "errors.clock.invalidClear", locale)

    def pick[T](sent: T | None, current: T, name: str) -> T | None:
        """The sent value, the current one, or None when cleared."""
        if name in cleared:
            return None
        return current if sent is None else sent

    settings = _clean(
        SettingsBody(
            description=clock.description if body.description is None else body.description,
            segments=clock.segments if body.segments is None else body.segments,
            color=body.color or clock.color,
            stage_labels=list(clock.stage_labels)
            if body.stage_labels is None
            else body.stage_labels,
            closing_condition=pick(
                body.closing_condition, clock.closing_condition, "closing_condition"
            ),
            consequence=pick(body.consequence, clock.consequence, "consequence"),
            forward_only=clock.forward_only if body.forward_only is None else body.forward_only,
            mark_policy=pick(body.mark_policy, clock.mark_policy, "mark_policy"),
            label_ids=list(clock.label_ids) if body.label_ids is None else body.label_ids,
        ),
        locale,
    )
    try:
        name = clock.name if body.name is None else clean_name(body.name)
    except ClockFieldError as exc:
        raise _fail(exc, locale) from exc
    filled, state = resized(clock, settings.segments)
    return replace(
        clock,
        name=name,
        description=settings.description,
        segments=settings.segments,
        filled=filled,
        state=state,
        color=settings.color,
        stage_labels=settings.stage_labels,
        closing_condition=settings.closing_condition,
        consequence=settings.consequence,
        forward_only=settings.forward_only,
        mark_policy=settings.mark_policy,
        label_ids=settings.label_ids,
        document_id=pick(body.document_id, clock.document_id, "document_id"),
        visibility=body.visibility or clock.visibility,
    )


@router.patch("/clocks/{clock_id}")
async def update_clock(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    body: UpdateClockRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ClockResponse:
    """Decisions 4-6, 14-15: the clock's creator or the Master changes its
    settings, who sees it (audited) or archives and restores it. Only the
    Master touches the consequence (403). 412 when the clock moved past
    `base_revision`."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clock, grants = await _managed_clock(session, room_id, clock_id, membership, locale)
    try:
        ensure_base_revision(clock, body.base_revision)
    except StaleClockError as exc:
        raise _fail(exc, locale) from exc
    if membership.role != RoomRole.MASTER and (
        body.consequence is not None or "consequence" in body.clear
    ):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.clock.masterOnlyField", locale)
    before = await clock_audience(session, clock, grants)
    edited = _edited(clock, body, locale)
    if body.label_ids is not None:
        await _ensure_labels(session, room_id, edited.label_ids, locale)
    if body.document_id is not None and body.document_id != clock.document_id:
        await _check_document(session, room_id, body.document_id, membership, clock.id, locale)
    if body.selective_user_ids is not None:
        await ensure_room_members(
            session, room_id, body.selective_user_ids, "errors.clock.invalidSelectiveUsers", locale
        )
    now = _now()
    if body.archived is not None and body.archived != (clock.archived_at is not None):
        edited = replace(edited, archived_at=now if body.archived else None)
    updated = await clocks_repo.update_clock(session, replace(edited, updated_at=now))

    new_grants = grants
    if body.selective_user_ids is not None:
        new_grants = list(starting_grants(updated.visibility, body.selective_user_ids))
        await clocks_repo.set_grants(session, clock_id, new_grants)
    elif updated.visibility != DocumentVisibility.SELECTIVE and grants:
        new_grants = []
        await clocks_repo.set_grants(session, clock_id, new_grants)
    audit = clock_visibility_audit(
        clock, updated.visibility, membership.user_id, grants, body.selective_user_ids
    )
    if audit is not None:
        await rooms_repo.insert_audit_log(session, audit)

    changed = edited_fields(clock, updated)
    if body.selective_user_ids is not None and set(body.selective_user_ids) != set(grants):
        changed.append("selective_user_ids")
    if changed:
        await _record(session, updated, membership.user_id, HistoryAction.EDITED, fields=changed)
    await record_state_change(session, clock, updated, membership.user_id)
    if body.archived is not None and (clock.archived_at is None) != (updated.archived_at is None):
        action = HistoryAction.ARCHIVED if body.archived else HistoryAction.RESTORED
        await _record(session, updated, membership.user_id, action)
    await push_clock(session, updated, new_grants, before=before)
    return await _one(session, updated, membership)


@router.post("/clocks/{clock_id}/open")
async def open_proposal(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ClockResponse:
    """Decision 13: the Master opens a proposed clock ("Apri il clock"),
    after any change of size, labels or visibility through PATCH. 409 when
    it isn't a proposal. Refusing is deleting it."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    _ensure_master(membership, locale)
    clock, grants = await get_visible_clock(
        session, room_id, clock_id, membership, locale, lock=True
    )
    if clock.state != ClockState.PROPOSED:
        raise http_error(status.HTTP_409_CONFLICT, "errors.clock.notProposed", locale)
    before = await clock_audience(session, clock, grants)
    filled, state = resized(replace(clock, state=ClockState.OPEN), clock.segments)
    updated = await clocks_repo.update_clock(
        session, replace(clock, state=state, filled=filled, updated_at=_now())
    )
    await _record(session, updated, membership.user_id, HistoryAction.OPENED)
    await push_clock(session, updated, grants, before=before)
    return await _one(session, updated, membership)


@router.delete("/clocks/{clock_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_clock(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """Decisions 5, 13: the creator or the Master deletes a clock, with its
    marks and history (the client asks first, no undo). The Master
    deleting a proposal is "Rifiuta"."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clock, grants = await _managed_clock(session, room_id, clock_id, membership, locale)
    await push_clock(session, clock, grants, kind=DELETED)
    await clocks_repo.delete_clock(session, clock_id)


async def _is_locked(session: AsyncSession, clock: Clock) -> bool:
    """Whether the clock waits behind an earlier one of its sequence."""
    if clock.group_id is None:
        return False
    group = await clocks_repo.get_group(session, clock.group_id)
    members = [
        other
        for other in await clocks_repo.list_clocks(session, clock.room_id)
        if other.group_id == clock.group_id
    ]
    return is_locked(clock, group, members)


@router.post("/clocks/{clock_id}/marks", status_code=status.HTTP_201_CREATED)
async def mark_clock(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    body: MarkRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MarkResponse:
    """Decisions 7-9: fills (or, `delta` < 0, empties) segments, clamped
    under the clock's lock so two marks at once both count. 403 unless the
    member may mark it, or use the kind, or empty it; 409 when the clock
    takes no marks (proposed, lapsed, archived, locked in its sequence, or
    nothing to change). Closing or reopening is part of the mark."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clock, grants = await get_visible_clock(
        session, room_id, clock_id, membership, locale, lock=True
    )
    rules = await clocks_repo.get_rules(session, room_id)
    if not can_mark_clock(clock, rules, membership.user_id, membership.role):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.clock.notMarker", locale)
    try:
        note = clean_line(body.note, MAX_NOTE_LENGTH, "note")
        outcome = apply_mark(clock, rules, body.delta, locked=await _is_locked(session, clock))
        kind_id = None
        if body.delta > 0:
            kinds = await clocks_repo.list_kinds(session, room_id)
            kind_id = choose_kind(kinds, body.kind_id, membership.role)
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    now = _now()
    mark = ClockMark(
        id=uuid.uuid4(),
        clock_id=clock_id,
        user_id=membership.user_id,
        kind_id=kind_id,
        delta=outcome.applied,
        note=note,
        created_at=now,
    )
    await clocks_repo.insert_mark(session, mark)
    updated = await clocks_repo.update_clock(
        session, replace(clock, filled=outcome.filled, state=outcome.state, updated_at=now)
    )
    await _record(
        session,
        updated,
        membership.user_id,
        HistoryAction.MARKED,
        mark_id=str(mark.id),
        delta=outcome.applied,
        kind_id=None if kind_id is None else str(kind_id),
        note=note,
        filled=updated.filled,
        segments=updated.segments,
    )
    await record_state_change(session, clock, updated, membership.user_id)
    await push_clock(session, updated, grants, kind=MARKED)
    return MarkResponse(clock=await _one(session, updated, membership), mark_id=mark.id)


@router.post("/clocks/{clock_id}/marks/{mark_id}/undo")
async def undo_clock_mark(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    mark_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> MarkResponse:
    """Decision 9: "Annulla" on the toast. The marker takes back their own
    mark for a short while, even under "Non si torna indietro" (logged as a
    correction). 403 for someone else's mark; 409 once undone or too old."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    clock, grants = await get_visible_clock(
        session, room_id, clock_id, membership, locale, lock=True
    )
    mark = await clocks_repo.get_mark(session, mark_id)
    if mark is None or mark.clock_id != clock_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.clock.markNotFound", locale)
    now = _now()
    try:
        outcome = undo_mark(clock, mark, membership.user_id, now)
    except _ERRORS as exc:
        raise _fail(exc, locale) from exc
    await clocks_repo.set_mark_undone(session, mark_id, now)
    updated = await clocks_repo.update_clock(
        session, replace(clock, filled=outcome.filled, state=outcome.state, updated_at=now)
    )
    await _record(
        session,
        updated,
        membership.user_id,
        HistoryAction.UNDONE,
        mark_id=str(mark_id),
        delta=outcome.applied,
        filled=updated.filled,
        segments=updated.segments,
    )
    await record_state_change(session, clock, updated, membership.user_id)
    await push_clock(session, updated, grants, kind=MARKED)
    return MarkResponse(clock=await _one(session, updated, membership), mark_id=mark_id)


@router.get("/clocks/{clock_id}/history")
async def clock_history(
    room_id: uuid.UUID,
    clock_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    before: datetime | None = None,
) -> HistoryResponse:
    """Decision 10: the clock's history, 50 lines at a time, newest first,
    for whoever sees the clock; a Player never reads that the consequence
    changed."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    await get_visible_clock(session, room_id, clock_id, membership, locale)
    events = await clocks_repo.list_events(session, clock_id, before, HISTORY_PAGE_SIZE)
    shown = [visible_event(event, membership.role) for event in events]
    return HistoryResponse(
        entries=[
            HistoryEntry(
                id=event.id,
                user_id=event.user_id,
                action=event.action,
                details=event.details,
                created_at=event.created_at,
            )
            for event in shown
        ],
        next_before=events[-1].created_at if len(events) == HISTORY_PAGE_SIZE else None,
    )

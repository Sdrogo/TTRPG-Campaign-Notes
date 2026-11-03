"""Clocks (spec 61): a Room's progress clocks, the rules that say who opens
and marks them, their labels, mark kinds, templates and groups. Pure rules
only: the routes in `app/api/clocks.py` read and write through
`app/db/clocks_repo.py` and decide here."""

import uuid
from collections import Counter
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any

from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, DocumentVisibility, RoomRole
from app.domain.relationship_maps import MapColor
from app.domain.visibility import is_content_visible

# --- Limits (Decision 31) -----------------------------------------------------

MIN_SEGMENTS = 2
MAX_SEGMENTS = 16
MAX_NAME_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 2000
MAX_STAGE_LABEL_LENGTH = 60
MAX_CLOSING_CONDITION_LENGTH = 140
MAX_CONSEQUENCE_LENGTH = 500
MAX_LABEL_NAME_LENGTH = 30
MAX_DECISIVE_LABEL_LENGTH = 30
MAX_NOTE_LENGTH = 200
MAX_LABELS_PER_CLOCK = 6
MAX_LABELS_PER_ROOM = 100
MAX_MARK_KINDS = 6
MAX_CLOCKS_PER_ROOM = 200
MAX_GROUPS_PER_ROOM = 30
MAX_TEMPLATES_PER_ROOM = 20
MAX_CLOCKS_PER_DOCUMENT = 6
MAX_CLOCKS_PER_GROUP = 12
HISTORY_PAGE_SIZE = 50
# The client offers "Annulla" for 5 s (Decision 9); the server leaves room
# for a slow network.
UNDO_WINDOW = timedelta(seconds=30)

CLOCK_VISIBILITY_CHANGED = "clock_visibility_changed"


class OpenPolicy(StrEnum):
    """Who opens a clock (Decision 1)."""

    MASTER = "master"
    EVERYONE = "everyone"
    PROPOSE = "propose"


class MarkPolicy(StrEnum):
    """Who marks a clock (Decision 1), for the Room or one clock (Decision 6)."""

    MASTER = "master"
    MASTER_AND_CREATOR = "master_and_creator"
    EVERYONE = "everyone"


class KindWho(StrEnum):
    """Who may use a mark kind (Decision 1)."""

    MASTER = "master"
    PLAYERS = "players"
    EVERYONE = "everyone"


class ClockState(StrEnum):
    """Decision 5. Archiving is `archived_at`, apart from the state."""

    PROPOSED = "proposed"
    OPEN = "open"
    CLOSED = "closed"
    LAPSED = "lapsed"


class GroupMode(StrEnum):
    """Decision 11."""

    FREE = "free"
    RACE = "race"
    TURN = "turn"
    SEQUENCE = "sequence"


class HistoryAction(StrEnum):
    """What a line of a clock's history records (Decision 10)."""

    CREATED = "created"
    PROPOSED = "proposed"
    OPENED = "opened"
    MARKED = "marked"
    UNDONE = "undone"
    CLOSED = "closed"
    REOPENED = "reopened"
    LAPSED = "lapsed"
    ARCHIVED = "archived"
    RESTORED = "restored"
    EDITED = "edited"


# --- Errors -------------------------------------------------------------------


class ClockFieldError(DomainError):
    """A field is missing, too long or out of range (422)."""


class ClockLimitError(DomainError):
    """A Room, clock, group or Document cap is reached (409)."""


class ClockNameTakenError(DomainError):
    """A label or mark kind with this name already exists in the Room (409)."""


class UnknownClockItemError(DomainError):
    """A label, mark kind, Document or group isn't the Room's (422)."""


class ClockNotMarkableError(DomainError):
    """The clock takes no marks now: proposed, lapsed, archived, closed,
    locked in its sequence, or the mark changes nothing (409)."""


class UnmarkNotAllowedError(DomainError):
    """The rules or the clock refuse emptying segments (403)."""


class MarkKindNotAllowedError(DomainError):
    """The marker may not use this mark kind (403)."""


class UndoNotAllowedError(DomainError):
    """The mark isn't the caller's to undo (403)."""


class UndoExpiredError(DomainError):
    """The mark was undone already or is too old to undo (409)."""


class MasterOnlyFieldError(DomainError):
    """A Player sent a field only the Master sets (403)."""


class StaleClockError(DomainError):
    """The clock changed since the revision the edit is based on (412)."""


class GroupNotEndableError(DomainError):
    """The group has no result to confirm, or has ended already (409)."""


# --- Model --------------------------------------------------------------------


@dataclass(frozen=True)
class ClockRules:
    """The Room's clock rules (Decision 1); the defaults are "Semplice"
    (Decision 2), what a Room without a saved row follows."""

    room_id: uuid.UUID
    open_policy: OpenPolicy = OpenPolicy.MASTER
    mark_policy: MarkPolicy = MarkPolicy.MASTER
    allow_unmark: bool = True


@dataclass(frozen=True)
class ClockLabel:
    """A free label of the Room's clocks."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    color: MapColor
    position: int


@dataclass(frozen=True)
class MarkKind:
    """A kind of mark the Master defined."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    color: MapColor
    who: KindWho
    position: int


@dataclass(frozen=True)
class ClockSettings:
    """What a clock's dialog sets and a template keeps (Decisions 3-6),
    already cleaned."""

    description: str = ""
    segments: int = 6
    color: MapColor = MapColor.DEFAULT
    stage_labels: tuple[str, ...] = ()
    closing_condition: str | None = None
    consequence: str | None = None
    forward_only: bool = False
    mark_policy: MarkPolicy | None = None
    label_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True)
class ClockTemplate:
    """A Room's clock template (Decision 3)."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    settings: ClockSettings
    position: int
    created_at: datetime


@dataclass(frozen=True)
class Clock:
    """A clock (Decisions 4-6). `filled` is how many segments are filled;
    `label_ids` in the clock's order."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    segments: int
    color: MapColor
    state: ClockState
    visibility: DocumentVisibility
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    position: int
    description: str = ""
    filled: int = 0
    stage_labels: tuple[str, ...] = ()
    closing_condition: str | None = None
    consequence: str | None = None
    forward_only: bool = False
    mark_policy: MarkPolicy | None = None
    archived_at: datetime | None = None
    group_id: uuid.UUID | None = None
    group_position: int | None = None
    decisive_label: str | None = None
    document_id: uuid.UUID | None = None
    revision: int = 0
    label_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True)
class ClockMark:
    """One mark: the segments it moved after the clamp."""

    id: uuid.UUID
    clock_id: uuid.UUID
    user_id: uuid.UUID | None
    kind_id: uuid.UUID | None
    delta: int
    note: str | None
    created_at: datetime
    undone_at: datetime | None = None


@dataclass(frozen=True)
class ClockEvent:
    """A line of a clock's history."""

    id: uuid.UUID
    clock_id: uuid.UUID
    user_id: uuid.UUID | None
    action: HistoryAction
    details: dict[str, Any]
    created_at: datetime


@dataclass(frozen=True)
class ClockGroup:
    """A group of clocks (Decision 11). `result` once a race or turn ended:
    `{"winner_ids": [...], "tie": bool}` or `{"outcomes": [...]}`."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    mode: GroupMode
    position: int
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    ended_at: datetime | None = None
    result: dict[str, Any] | None = None
    revision: int = 0


@dataclass(frozen=True)
class MarkOutcome:
    """What a mark or an undo does to its clock: the segments it really
    moves, the new count and the new state."""

    applied: int
    filled: int
    state: ClockState


@dataclass(frozen=True)
class GroupEnd:
    """A confirmed race or turn: the group's result and the clocks that
    lapse with it (Decision 11)."""

    result: dict[str, Any]
    lapsed_ids: list[uuid.UUID] = field(default_factory=list)


# --- Cleaning -----------------------------------------------------------------


def _too_long(field_key: str, limit: int) -> ClockFieldError:
    """The 422 for a field past its limit."""
    return ClockFieldError(
        "errors.clock.tooLong", field=f"@errors.clock.fields.{field_key}", max=limit
    )


def clean_line(value: str | None, limit: int, field_key: str) -> str | None:
    """One line of plain text: whitespace collapsed, None when empty."""
    if value is None:
        return None
    cleaned = " ".join(value.split())
    if len(cleaned) > limit:
        raise _too_long(field_key, limit)
    return cleaned or None


def clean_text(value: str | None, limit: int, field_key: str) -> str | None:
    """Markdown over several lines: only the ends trimmed, None when empty."""
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) > limit:
        raise _too_long(field_key, limit)
    return cleaned or None


def clean_name(value: str, limit: int = MAX_NAME_LENGTH, field_key: str = "name") -> str:
    """A required name."""
    cleaned = clean_line(value, limit, field_key)
    if cleaned is None:
        raise ClockFieldError("errors.clock.nameRequired")
    return cleaned


def clean_settings(
    *,
    description: str | None,
    segments: int,
    color: MapColor,
    stage_labels: Sequence[str],
    closing_condition: str | None,
    consequence: str | None,
    forward_only: bool,
    mark_policy: MarkPolicy | None,
    label_ids: Sequence[uuid.UUID],
) -> ClockSettings:
    """Decision 4: a clock's settings checked and cleaned. Stage labels are
    at most one per segment; trailing empty ones are dropped."""
    if not MIN_SEGMENTS <= segments <= MAX_SEGMENTS:
        raise ClockFieldError("errors.clock.invalidSegments", min=MIN_SEGMENTS, max=MAX_SEGMENTS)
    stages = [clean_line(stage, MAX_STAGE_LABEL_LENGTH, "stage") or "" for stage in stage_labels]
    while stages and not stages[-1]:
        stages.pop()
    if len(stages) > segments:
        raise ClockFieldError("errors.clock.tooManyStages")
    if len(label_ids) > MAX_LABELS_PER_CLOCK:
        raise ClockFieldError("errors.clock.tooManyLabels", max=MAX_LABELS_PER_CLOCK)
    if len(set(label_ids)) != len(label_ids):
        raise ClockFieldError("errors.clock.duplicateLabel")
    return ClockSettings(
        description=clean_text(description, MAX_DESCRIPTION_LENGTH, "description") or "",
        segments=segments,
        color=color,
        stage_labels=tuple(stages),
        closing_condition=clean_line(
            closing_condition, MAX_CLOSING_CONDITION_LENGTH, "closingCondition"
        ),
        consequence=clean_text(consequence, MAX_CONSEQUENCE_LENGTH, "consequence"),
        forward_only=forward_only,
        mark_policy=mark_policy,
        label_ids=tuple(label_ids),
    )


def ensure_known(ids: Iterable[uuid.UUID], known: Collection[uuid.UUID], key: str) -> None:
    """422 (`key`) unless every one of `ids` is among `known`, the Room's."""
    if not set(ids) <= set(known):
        raise UnknownClockItemError(key)


def ensure_below(count: int, limit: int, key: str) -> None:
    """409 (`key`) when `count` items already reach `limit`."""
    if count >= limit:
        raise ClockLimitError(key, max=limit)


def ensure_name_free(name: str, taken: Iterable[str], key: str) -> None:
    """409 (`key`) when another label or mark kind has this name, whatever
    the case."""
    if name.casefold() in {other.casefold() for other in taken}:
        raise ClockNameTakenError(key)


def settings_to_json(settings: ClockSettings) -> dict[str, Any]:
    """A template's settings as stored."""
    return {
        "description": settings.description,
        "segments": settings.segments,
        "color": settings.color.value,
        "stage_labels": list(settings.stage_labels),
        "closing_condition": settings.closing_condition,
        "consequence": settings.consequence,
        "forward_only": settings.forward_only,
        "mark_policy": None if settings.mark_policy is None else settings.mark_policy.value,
        "label_ids": [str(label_id) for label_id in settings.label_ids],
    }


def settings_from_json(stored: Mapping[str, Any]) -> ClockSettings:
    """A template's stored settings."""
    mark_policy = stored.get("mark_policy")
    return ClockSettings(
        description=stored.get("description", ""),
        segments=stored.get("segments", 6),
        color=MapColor(stored.get("color", MapColor.DEFAULT.value)),
        stage_labels=tuple(stored.get("stage_labels", ())),
        closing_condition=stored.get("closing_condition"),
        consequence=stored.get("consequence"),
        forward_only=stored.get("forward_only", False),
        mark_policy=None if mark_policy is None else MarkPolicy(mark_policy),
        label_ids=tuple(uuid.UUID(label_id) for label_id in stored.get("label_ids", ())),
    )


# --- Rights (Decisions 1, 6, 13, 14) -------------------------------------------


def creation_state(
    role: RoomRole, rules: ClockRules, players_can_create_documents: bool
) -> ClockState | None:
    """What a new clock of this member starts as: open, a proposal, or None
    when they may not create one. The Master always opens; Players follow
    the rules, and never while the Room bars them from creating Documents
    (D-13)."""
    if role == RoomRole.MASTER:
        return ClockState.OPEN
    if not players_can_create_documents:
        return None
    match rules.open_policy:
        case OpenPolicy.EVERYONE:
            return ClockState.OPEN
        case OpenPolicy.PROPOSE:
            return ClockState.PROPOSED
        case OpenPolicy.MASTER:
            return None


def can_manage_clock(clock: Clock, user_id: uuid.UUID, role: RoomRole) -> bool:
    """Decision 14: the creator and the Master change, archive and delete a
    clock."""
    return role == RoomRole.MASTER or user_id == clock.created_by


def effective_mark_policy(clock: Clock, rules: ClockRules) -> MarkPolicy:
    """The clock's own rule, else the Room's (Decision 6)."""
    return clock.mark_policy or rules.mark_policy


def can_mark_clock(clock: Clock, rules: ClockRules, user_id: uuid.UUID, role: RoomRole) -> bool:
    """Whether this member may mark the clock (the caller has checked they
    see it). Says nothing of its state."""
    if role == RoomRole.MASTER:
        return True
    match effective_mark_policy(clock, rules):
        case MarkPolicy.MASTER:
            return False
        case MarkPolicy.MASTER_AND_CREATOR:
            return user_id == clock.created_by
        case MarkPolicy.EVERYONE:
            return True


def can_unmark(clock: Clock, rules: ClockRules) -> bool:
    """Whether segments can be emptied: the Room allows it and the clock
    isn't "Solo avanti" (Decision 1, 6)."""
    return rules.allow_unmark and not clock.forward_only


def can_use_kind(kind: MarkKind, role: RoomRole) -> bool:
    """Decision 1: a mark kind's "who may use it"."""
    match kind.who:
        case KindWho.EVERYONE:
            return True
        case KindWho.MASTER:
            return role == RoomRole.MASTER
        case KindWho.PLAYERS:
            return role == RoomRole.PLAYER


def ensure_settings_allowed(role: RoomRole, settings: ClockSettings) -> None:
    """Decision 4, 13: only the Master writes a consequence."""
    if role != RoomRole.MASTER and settings.consequence is not None:
        raise MasterOnlyFieldError("errors.clock.masterOnlyField")


def is_clock_visible(
    clock: Clock, user_id: uuid.UUID, role: RoomRole, selective_user_ids: Collection[uuid.UUID]
) -> bool:
    """Decision 15: the Comment levels with the creator as the Owner. A
    proposal is its proposer's and the Master's alone (Decision 13)."""
    if clock.state == ClockState.PROPOSED:
        return role == RoomRole.MASTER or user_id == clock.created_by
    return is_content_visible(
        clock.visibility, user_id, role, {clock.created_by}, selective_user_ids
    )


def visible_clock(clock: Clock, role: RoomRole) -> Clock:
    """The clock as this member reads it: the consequence is the Master's
    only (Decision 14), also under View as."""
    if role == RoomRole.MASTER or clock.consequence is None:
        return clock
    return replace(clock, consequence=None)


def visible_template(template: ClockTemplate, role: RoomRole) -> ClockTemplate:
    """A template as this member reads it, without the Master's consequence."""
    if role == RoomRole.MASTER or template.settings.consequence is None:
        return template
    return replace(template, settings=replace(template.settings, consequence=None))


def ensure_base_revision(clock: Clock, base_revision: int | None) -> None:
    """412 when the clock moved past the revision the edit is based on."""
    if base_revision is not None and base_revision != clock.revision:
        raise StaleClockError("errors.clock.changedByOthers")


def clock_visibility_audit(
    before: Clock,
    after_visibility: DocumentVisibility,
    editor_id: uuid.UUID,
    current_selective_ids: Collection[uuid.UUID],
    new_selective_ids: Collection[uuid.UUID] | None,
) -> AuditLogEntry | None:
    """Decision 15: the AuditLog row for an edit that changes who sees a
    clock, its level or its Selective grants (Invariant 7), or None."""
    grants_changed = new_selective_ids is not None and set(new_selective_ids) != set(
        current_selective_ids
    )
    if after_visibility == before.visibility and not grants_changed:
        return None
    grants = current_selective_ids if new_selective_ids is None else new_selective_ids
    return AuditLogEntry(
        id=uuid.uuid4(),
        room_id=before.room_id,
        actor_user_id=editor_id,
        target_user_id=None,
        action=CLOCK_VISIBILITY_CHANGED,
        details={
            "clock_id": str(before.id),
            "from": before.visibility.value,
            "to": after_visibility.value,
            "selective_user_ids": sorted(str(user_id) for user_id in grants),
        },
    )


# --- Marking (Decisions 7-9) ---------------------------------------------------


def _state_for(filled: int, segments: int) -> ClockState:
    """Closed once every segment is filled, open otherwise."""
    return ClockState.CLOSED if filled >= segments else ClockState.OPEN


def ensure_markable(clock: Clock, *, locked: bool = False) -> None:
    """409 unless the clock takes marks: not proposed, lapsed or archived,
    and not locked behind an earlier clock of its sequence."""
    if clock.archived_at is not None or clock.state in (ClockState.PROPOSED, ClockState.LAPSED):
        raise ClockNotMarkableError("errors.clock.notOpen")
    if locked:
        raise ClockNotMarkableError("errors.clock.locked")


def apply_mark(clock: Clock, rules: ClockRules, delta: int, *, locked: bool = False) -> MarkOutcome:
    """Decision 9: a mark of `delta` segments (negative empties), clamped to
    the clock, so two marks sent at once both count as far as they fit.
    Emptying needs the rules' consent; a mark that would change nothing is
    refused. Filling the last segment closes the clock; emptying one of a
    closed clock reopens it."""
    if delta == 0:
        raise ClockFieldError("errors.clock.invalidDelta")
    ensure_markable(clock, locked=locked)
    if delta < 0 and not can_unmark(clock, rules):
        raise UnmarkNotAllowedError("errors.clock.noUnmark")
    filled = min(max(clock.filled + delta, 0), clock.segments)
    if filled == clock.filled:
        raise ClockNotMarkableError("errors.clock.nothingToMark")
    return MarkOutcome(
        applied=filled - clock.filled, filled=filled, state=_state_for(filled, clock.segments)
    )


def undo_mark(clock: Clock, mark: ClockMark, user_id: uuid.UUID, now: datetime) -> MarkOutcome:
    """Decision 9: the marker takes back their own mark for a short while,
    even under "Non si torna indietro" (a correction). Refused once undone,
    too old, or when the clock no longer takes marks."""
    if mark.user_id != user_id:
        raise UndoNotAllowedError("errors.clock.notYourMark")
    if mark.undone_at is not None or now - mark.created_at > UNDO_WINDOW:
        raise UndoExpiredError("errors.clock.undoExpired")
    ensure_markable(clock)
    filled = min(max(clock.filled - mark.delta, 0), clock.segments)
    return MarkOutcome(
        applied=filled - clock.filled, filled=filled, state=_state_for(filled, clock.segments)
    )


def resized(clock: Clock, segments: int) -> tuple[int, ClockState]:
    """A clock's count and state after a change of size: the count clamped,
    an open clock now full closes, a closed one with room reopens. A
    proposal or a lapsed clock keeps its state."""
    filled = min(clock.filled, segments)
    if clock.state in (ClockState.OPEN, ClockState.CLOSED):
        return filled, _state_for(filled, segments)
    return filled, clock.state


def choose_kind(
    kinds: Sequence[MarkKind], kind_id: uuid.UUID | None, role: RoomRole
) -> uuid.UUID | None:
    """Decision 8: the mark's kind. None sent takes the first kind this
    member may use (or none when the Room has none they may use); a sent
    kind must be the Room's (422) and theirs to use (403)."""
    if kind_id is None:
        return next((kind.id for kind in kinds if can_use_kind(kind, role)), None)
    kind = next((kind for kind in kinds if kind.id == kind_id), None)
    if kind is None:
        raise UnknownClockItemError("errors.clock.unknownKind")
    if not can_use_kind(kind, role):
        raise MarkKindNotAllowedError("errors.clock.kindNotAllowed")
    return kind.id


def segment_kinds(marks: Iterable[ClockMark], filled: int) -> list[uuid.UUID | None]:
    """Decision 8: the kind of each filled segment, first to last. The live
    marks, oldest first, fill and empty a stack; the result is cut or padded
    (no kind) to the clock's count, which a change of size may have
    clamped."""
    stack: list[uuid.UUID | None] = []
    for mark in marks:
        if mark.undone_at is not None:
            continue
        if mark.delta > 0:
            stack.extend([mark.kind_id] * mark.delta)
        else:
            del stack[len(stack) + mark.delta :]
    stack = stack[:filled]
    return stack + [None] * (filled - len(stack))


def kind_counts(kinds: Iterable[uuid.UUID | None]) -> dict[uuid.UUID | None, int]:
    """How many filled segments each kind holds (an export's marks)."""
    return dict(Counter(kinds))


# --- History (Decision 10) -----------------------------------------------------


def edited_fields(before: Clock, after: Clock) -> list[str]:
    """The settings an edit changed, by name, for the history line."""
    names = [
        "name",
        "description",
        "segments",
        "color",
        "stage_labels",
        "closing_condition",
        "consequence",
        "forward_only",
        "mark_policy",
        "label_ids",
        "document_id",
        "visibility",
    ]
    return [name for name in names if getattr(before, name) != getattr(after, name)]


def visible_event(event: ClockEvent, role: RoomRole) -> ClockEvent:
    """A history line as this member reads it: a Player never learns that
    the consequence changed."""
    fields = event.details.get("fields")
    if role == RoomRole.MASTER or not fields or "consequence" not in fields:
        return event
    details = {**event.details, "fields": [name for name in fields if name != "consequence"]}
    return replace(event, details=details)


# --- Groups (Decisions 11-12) --------------------------------------------------


def group_order(clocks: Iterable[Clock]) -> list[Clock]:
    """A group's clocks in the group's order."""
    return sorted(clocks, key=lambda clock: (clock.group_position or 0, clock.created_at))


def sequence_markable_id(clocks: Iterable[Clock]) -> uuid.UUID | None:
    """Decision 11: in a sequence only the first clock not yet closed takes
    marks (archived ones are skipped)."""
    for clock in group_order(clocks):
        if clock.archived_at is None and clock.state == ClockState.OPEN:
            return clock.id
    return None


def is_locked(clock: Clock, group: ClockGroup | None, group_clocks: Iterable[Clock]) -> bool:
    """Whether a clock of a sequence waits behind an earlier one."""
    if group is None or group.mode != GroupMode.SEQUENCE or clock.state != ClockState.OPEN:
        return False
    return sequence_markable_id(group_clocks) != clock.id


def pending_ids(group: ClockGroup, clocks: Iterable[Clock]) -> list[uuid.UUID]:
    """The clocks whose close waits for the Master's confirmation: every
    closed clock of a race, every closed decisive clock of a turn, while the
    group hasn't ended. Two or more in a race make a tie."""
    if group.ended_at is not None or group.mode not in (GroupMode.RACE, GroupMode.TURN):
        return []
    return [
        clock.id
        for clock in group_order(clocks)
        if clock.state == ClockState.CLOSED
        and clock.archived_at is None
        and (group.mode == GroupMode.RACE or clock.decisive_label is not None)
    ]


def end_group(group: ClockGroup, clocks: Sequence[Clock]) -> GroupEnd:
    """Decision 11: the Master confirms a race ("Vinto", or "Pari" when more
    than one clock closed) or ends a turn (its closed decisive clocks give
    the outcomes; the clocks still open lapse)."""
    pending = pending_ids(group, clocks)
    if not pending:
        raise GroupNotEndableError("errors.clock.groupNotEndable")
    if group.mode == GroupMode.RACE:
        return GroupEnd(
            result={"winner_ids": [str(clock_id) for clock_id in pending], "tie": len(pending) > 1}
        )
    by_id = {clock.id: clock for clock in clocks}
    outcomes = [
        {"clock_id": str(clock_id), "label": by_id[clock_id].decisive_label} for clock_id in pending
    ]
    lapsed = [
        clock.id
        for clock in group_order(clocks)
        if clock.state == ClockState.OPEN and clock.archived_at is None
    ]
    return GroupEnd(result={"outcomes": outcomes}, lapsed_ids=lapsed)


def visible_result(
    result: Mapping[str, Any] | None, visible_ids: Collection[uuid.UUID]
) -> dict[str, Any] | None:
    """Decision 15: a group's result naming only the clocks this member
    sees (the tie flag stays: both events happened)."""
    if result is None:
        return None
    shown = {str(clock_id) for clock_id in visible_ids}
    if "winner_ids" in result:
        return {**result, "winner_ids": [cid for cid in result["winner_ids"] if cid in shown]}
    return {
        **result,
        "outcomes": [o for o in result.get("outcomes", []) if o["clock_id"] in shown],
    }

"""Clocks in the Room's JSON export and the import (spec 61 Decision 27).

The export writes the clock rules with the Room's labels and mark kinds, the
templates, the clocks the requester sees (marks as counts per kind, the
Master's consequence only in a Master's file) and their groups; never the
history. The Master's import adds the clocks and groups of a file to the
Room, merging labels and mark kinds by name and pointing a clock at a
Document imported with it. Pure: no database. Whatever a file says goes
through the rules of an edit (`clean_settings`, `clean_name`); an entry that
doesn't pass is skipped alone."""

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from app.domain.clocks import (
    MAX_CLOCKS_PER_GROUP,
    MAX_DECISIVE_LABEL_LENGTH,
    MAX_LABEL_NAME_LENGTH,
    MAX_LABELS_PER_ROOM,
    MAX_MARK_KINDS,
    Clock,
    ClockGroup,
    ClockLabel,
    ClockMark,
    ClockSetup,
    ClockState,
    GroupMode,
    KindWho,
    MarkKind,
    MarkPolicy,
    clean_line,
    clean_name,
    clean_settings,
    kind_counts,
    segment_kinds,
    settings_to_json,
    visible_template,
)
from app.domain.errors import DomainError
from app.domain.models import DocumentVisibility, RoomRole
from app.domain.relationship_maps import MapColor

# --- Export --------------------------------------------------------------------


def clocks_to_json(
    setup: ClockSetup,
    clocks: Sequence[Clock],
    groups: Sequence[ClockGroup],
    marks: Mapping[uuid.UUID, Sequence[ClockMark]],
    exported_documents: Mapping[uuid.UUID, str],
    role: RoomRole,
) -> dict[str, Any]:
    """The four clock keys of a Room's JSON export. `clocks` are those the
    requester sees, proposals left out; a clock's Document is named only
    when the file holds it; a group only when it holds one of the clocks."""
    is_master = role == RoomRole.MASTER
    shown = [clock for clock in clocks if clock.state != ClockState.PROPOSED]
    group_ids = {clock.group_id for clock in shown if clock.group_id is not None}
    return {
        "clock_rules": {
            "open_policy": setup.rules.open_policy.value,
            "mark_policy": setup.rules.mark_policy.value,
            "allow_unmark": setup.rules.allow_unmark,
            "labels": [
                {"id": str(label.id), "name": label.name, "color": label.color.value}
                for label in setup.labels
            ],
            "mark_kinds": [
                {
                    "id": str(kind.id),
                    "name": kind.name,
                    "color": kind.color.value,
                    "who": kind.who.value,
                }
                for kind in setup.kinds
            ],
        },
        "clock_templates": [
            {"name": template.name, "settings": settings_to_json(template.settings)}
            for template in (visible_template(t, role) for t in setup.templates)
        ],
        "clocks": [
            {
                "id": str(clock.id),
                "name": clock.name,
                "description": clock.description,
                "segments": clock.segments,
                "color": clock.color.value,
                "stage_labels": list(clock.stage_labels),
                "closing_condition": clock.closing_condition,
                "consequence": clock.consequence if is_master else None,
                "forward_only": clock.forward_only,
                "mark_policy": None if clock.mark_policy is None else clock.mark_policy.value,
                "state": clock.state.value,
                "archived": clock.archived_at is not None,
                "visibility": clock.visibility.value,
                "label_ids": [str(label_id) for label_id in clock.label_ids],
                "group_id": None if clock.group_id is None else str(clock.group_id),
                "group_position": clock.group_position,
                "decisive_label": clock.decisive_label,
                "document_id": str(clock.document_id)
                if clock.document_id in exported_documents
                else None,
                "marks": [
                    {"kind_id": None if kind is None else str(kind), "count": count}
                    for kind, count in kind_counts(
                        segment_kinds(marks.get(clock.id, ()), clock.filled)
                    ).items()
                ],
            }
            for clock in shown
        ],
        "clock_groups": [
            {
                "id": str(group.id),
                "name": group.name,
                "mode": group.mode.value,
                "ended": group.ended_at is not None,
            }
            for group in groups
            if group.id in group_ids
        ],
    }


# The keys of a JSON export that hold the clocks (schema 5).
CLOCK_KEYS = ("clock_rules", "clock_templates", "clocks", "clock_groups")


# --- Import --------------------------------------------------------------------


class _Unreadable(DomainError):
    """An entry of the file that isn't what the export writes."""


@dataclass(frozen=True)
class ClockImport:
    """What the import writes: the labels and mark kinds the Room lacks (by
    name), the groups, the clocks with their marks."""

    labels: tuple[ClockLabel, ...] = ()
    kinds: tuple[MarkKind, ...] = ()
    groups: tuple[ClockGroup, ...] = ()
    clocks: tuple[Clock, ...] = ()
    marks: tuple[ClockMark, ...] = ()
    skipped: int = 0


def _object(value: Any) -> dict[str, Any]:
    """A JSON object, or unreadable."""
    if not isinstance(value, dict):
        raise _Unreadable("clock")
    return value


def _list(value: Any) -> list[Any]:
    """A JSON list (absent is empty), or unreadable."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise _Unreadable("clock")
    return value


def _str(value: Any) -> str | None:
    """A string, absent, or unreadable."""
    if value is None or isinstance(value, str):
        return value
    raise _Unreadable("clock")


def _int(value: Any, default: int) -> int:
    """An integer (not a boolean), or unreadable."""
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise _Unreadable("clock")
    return value


def _choice[E: MapColor | KindWho | MarkPolicy | GroupMode | ClockState | DocumentVisibility](
    kind: type[E], value: Any, default: E
) -> E:
    """A value of `kind`; absent is `default`, anything else unreadable."""
    if value is None:
        return default
    try:
        return kind(value)
    except ValueError as exc:
        raise _Unreadable("clock") from exc


def _fold(name: str) -> str:
    """A name compared without case."""
    return name.casefold()


class _Book:
    """The Room's labels and mark kinds by name, growing with the ones a file
    brings, within the Room's caps."""

    def __init__(
        self,
        room_id: uuid.UUID,
        labels: Sequence[ClockLabel],
        kinds: Sequence[MarkKind],
        new_id: Callable[[], uuid.UUID],
    ) -> None:
        self.room_id = room_id
        self.labels = {_fold(label.name): label for label in labels}
        self.kinds = {_fold(kind.name): kind for kind in kinds}
        self.new_labels: list[ClockLabel] = []
        self.new_kinds: list[MarkKind] = []
        self.new_id = new_id

    def label(self, raw: Any) -> uuid.UUID | None:
        """The Room's label of this name, made when missing (None past the
        cap or for an unreadable entry)."""
        item = _object(raw)
        try:
            name = clean_name(_str(item.get("name")) or "", MAX_LABEL_NAME_LENGTH, "labelName")
        except DomainError:
            return None
        if _fold(name) not in self.labels:
            if len(self.labels) >= MAX_LABELS_PER_ROOM:
                return None
            label = ClockLabel(
                self.new_id(),
                self.room_id,
                name,
                _choice(MapColor, item.get("color"), MapColor.DEFAULT),
                len(self.labels),
            )
            self.labels[_fold(name)] = label
            self.new_labels.append(label)
        return self.labels[_fold(name)].id

    def kind(self, raw: Any) -> uuid.UUID | None:
        """The Room's mark kind of this name, made when missing (None past
        the cap or for an unreadable entry)."""
        item = _object(raw)
        try:
            name = clean_name(_str(item.get("name")) or "", MAX_LABEL_NAME_LENGTH, "kindName")
        except DomainError:
            return None
        if _fold(name) not in self.kinds:
            if len(self.kinds) >= MAX_MARK_KINDS:
                return None
            kind = MarkKind(
                self.new_id(),
                self.room_id,
                name,
                _choice(MapColor, item.get("color"), MapColor.DEFAULT),
                _choice(KindWho, item.get("who"), KindWho.EVERYONE),
                len(self.kinds),
            )
            self.kinds[_fold(name)] = kind
            self.new_kinds.append(kind)
        return self.kinds[_fold(name)].id


def _ids_by_file_id(
    raws: Sequence[Any], resolve: Callable[[Any], uuid.UUID | None]
) -> dict[str, uuid.UUID]:
    """Each readable entry's file id to what it resolves to in the Room."""
    found: dict[str, uuid.UUID] = {}
    for raw in raws:
        try:
            file_id = _str(_object(raw).get("id"))
            resolved = resolve(raw)
        except _Unreadable:
            continue
        if file_id and resolved is not None:
            found[file_id] = resolved
    return found


def plan_clock_import(
    files: Sequence[Mapping[str, Any]],
    documents: Sequence[Mapping[str, uuid.UUID]],
    room_id: uuid.UUID,
    creator: uuid.UUID,
    now: datetime,
    labels: Sequence[ClockLabel],
    kinds: Sequence[MarkKind],
    clocks_left: int,
    groups_left: int,
    next_position: int,
    new_id: Callable[[], uuid.UUID] = uuid.uuid4,
) -> ClockImport:
    """Decision 27: the clocks and groups of each file (its four clock keys
    in `files`, the file ids of its imported Documents to their ids in the
    Room in `documents`) planned into the Room, while it has room for them.
    A Selective clock becomes Private (grants don't travel); a proposal or
    an unreadable clock is skipped."""
    book = _Book(room_id, labels, kinds, new_id)
    groups: list[ClockGroup] = []
    clocks: list[Clock] = []
    marks: list[ClockMark] = []
    skipped = 0
    for data, file_documents in zip(files, documents, strict=True):
        try:
            rules = _object(data.get("clock_rules") or {})
            raw_labels = _list(rules.get("labels"))
            raw_kinds = _list(rules.get("mark_kinds"))
            raw_groups = _list(data.get("clock_groups"))
            raw_clocks = _list(data.get("clocks"))
        except _Unreadable:
            continue
        label_ids = _ids_by_file_id(raw_labels, book.label)
        kind_ids = _ids_by_file_id(raw_kinds, book.kind)
        group_ids: dict[str, ClockGroup] = {}
        for raw in raw_groups:
            try:
                item = _object(raw)
                file_id = _str(item.get("id"))
                name = clean_name(_str(item.get("name")) or "", field_key="groupName")
                mode = _choice(GroupMode, item.get("mode"), GroupMode.FREE)
            except DomainError:
                continue
            if not file_id or len(groups) >= groups_left:
                continue
            group = ClockGroup(
                id=new_id(),
                room_id=room_id,
                name=name,
                mode=mode,
                position=len(groups),
                created_by=creator,
                created_at=now,
                updated_at=now,
            )
            groups.append(group)
            group_ids[file_id] = group
        group_sizes: dict[uuid.UUID, int] = {}
        for raw in raw_clocks:
            try:
                clock, clock_marks = _plan_clock(
                    _object(raw),
                    room_id,
                    creator,
                    now,
                    next_position + len(clocks),
                    label_ids,
                    kind_ids,
                    group_ids,
                    file_documents,
                    new_id,
                )
            except DomainError:
                skipped += 1
                continue
            if len(clocks) >= clocks_left:
                skipped += 1
                continue
            group_id = clock.group_id
            if group_id is not None:
                size = group_sizes.get(group_id, 0)
                if size >= MAX_CLOCKS_PER_GROUP:
                    clock = replace(clock, group_id=None, group_position=None, decisive_label=None)
                else:
                    group_sizes[group_id] = size + 1
            clocks.append(clock)
            marks.extend(clock_marks)
    return ClockImport(
        labels=tuple(book.new_labels),
        kinds=tuple(book.new_kinds),
        groups=tuple(groups),
        clocks=tuple(clocks),
        marks=tuple(marks),
        skipped=skipped,
    )


def _plan_clock(
    item: dict[str, Any],
    room_id: uuid.UUID,
    creator: uuid.UUID,
    now: datetime,
    position: int,
    label_ids: Mapping[str, uuid.UUID],
    kind_ids: Mapping[str, uuid.UUID],
    groups: Mapping[str, ClockGroup],
    documents: Mapping[str, uuid.UUID],
    new_id: Callable[[], uuid.UUID],
) -> tuple[Clock, list[ClockMark]]:
    """One clock of the file and its marks (one per kind, as many segments
    as the file counts), or a `DomainError` to skip it."""
    state = _choice(ClockState, item.get("state"), ClockState.OPEN)
    if state == ClockState.PROPOSED:
        raise _Unreadable("clock")
    labels = [
        label_ids[label_id]
        for label_id in (_str(value) or "" for value in _list(item.get("label_ids")))
        if label_id in label_ids
    ]
    settings = clean_settings(
        description=_str(item.get("description")),
        segments=_int(item.get("segments"), 6),
        color=_choice(MapColor, item.get("color"), MapColor.DEFAULT),
        stage_labels=[_str(stage) or "" for stage in _list(item.get("stage_labels"))],
        closing_condition=_str(item.get("closing_condition")),
        consequence=_str(item.get("consequence")),
        forward_only=item.get("forward_only") is True,
        mark_policy=None
        if item.get("mark_policy") is None
        else _choice(MarkPolicy, item.get("mark_policy"), MarkPolicy.MASTER),
        label_ids=list(dict.fromkeys(labels)),
    )
    visibility = _choice(DocumentVisibility, item.get("visibility"), DocumentVisibility.ROOM)
    if visibility == DocumentVisibility.SELECTIVE:
        visibility = DocumentVisibility.PRIVATE
    clock_id = new_id()
    marks: list[ClockMark] = []
    filled = 0
    for raw in _list(item.get("marks")):
        mark = _object(raw)
        count = min(_int(mark.get("count"), 0), settings.segments - filled)
        if count <= 0:
            continue
        kind = _str(mark.get("kind_id"))
        marks.append(
            ClockMark(
                id=new_id(),
                clock_id=clock_id,
                user_id=creator,
                kind_id=kind_ids.get(kind) if kind else None,
                delta=count,
                note=None,
                created_at=now,
            )
        )
        filled += count
    if state in (ClockState.OPEN, ClockState.CLOSED):
        state = ClockState.CLOSED if filled >= settings.segments else ClockState.OPEN
    group = groups.get(_str(item.get("group_id")) or "")
    document = _str(item.get("document_id"))
    return (
        Clock(
            id=clock_id,
            room_id=room_id,
            name=clean_name(_str(item.get("name")) or ""),
            description=settings.description,
            segments=settings.segments,
            filled=filled,
            color=settings.color,
            stage_labels=settings.stage_labels,
            closing_condition=settings.closing_condition,
            consequence=settings.consequence,
            forward_only=settings.forward_only,
            mark_policy=settings.mark_policy,
            label_ids=settings.label_ids,
            state=state,
            archived_at=now if item.get("archived") is True else None,
            group_id=None if group is None else group.id,
            group_position=None if group is None else _int(item.get("group_position"), 0),
            decisive_label=None
            if group is None or group.mode != GroupMode.TURN
            else clean_line(
                _str(item.get("decisive_label")), MAX_DECISIVE_LABEL_LENGTH, "decisiveLabel"
            ),
            document_id=documents.get(document) if document else None,
            position=position,
            visibility=visibility,
            created_by=creator,
            created_at=now,
            updated_at=now,
        ),
        marks,
    )

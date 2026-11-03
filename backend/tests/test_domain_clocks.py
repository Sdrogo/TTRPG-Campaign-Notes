import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from app.domain.clocks import (
    UNDO_WINDOW,
    Clock,
    ClockEvent,
    ClockFieldError,
    ClockGroup,
    ClockLimitError,
    ClockMark,
    ClockNameTakenError,
    ClockNotMarkableError,
    ClockRules,
    ClockSettings,
    ClockState,
    ClockTemplate,
    GroupMode,
    GroupNotEndableError,
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
    can_use_kind,
    choose_kind,
    clean_line,
    clean_name,
    clean_settings,
    clean_text,
    clock_visibility_audit,
    creation_state,
    edited_fields,
    end_group,
    ensure_base_revision,
    ensure_below,
    ensure_known,
    ensure_name_free,
    ensure_settings_allowed,
    is_clock_visible,
    is_locked,
    kind_counts,
    pending_ids,
    resized,
    segment_kinds,
    sequence_markable_id,
    settings_from_json,
    settings_to_json,
    undo_mark,
    visible_clock,
    visible_event,
    visible_result,
    visible_template,
)
from app.domain.models import DocumentVisibility, RoomRole
from app.domain.relationship_maps import MapColor

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
ROOM = uuid.uuid4()
MASTER = RoomRole.MASTER
PLAYER = RoomRole.PLAYER


def _clock(**fields: object) -> Clock:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "room_id": ROOM,
        "name": "Allarme",
        "segments": 4,
        "color": MapColor.RED,
        "state": ClockState.OPEN,
        "visibility": DocumentVisibility.ROOM,
        "created_by": uuid.uuid4(),
        "created_at": NOW,
        "updated_at": NOW,
        "position": 0,
    }
    values.update(fields)
    return Clock(**values)  # type: ignore[arg-type]


def _group(mode: GroupMode, **fields: object) -> ClockGroup:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "room_id": ROOM,
        "name": "Fuga",
        "mode": mode,
        "position": 0,
        "created_by": uuid.uuid4(),
        "created_at": NOW,
        "updated_at": NOW,
    }
    values.update(fields)
    return ClockGroup(**values)  # type: ignore[arg-type]


def _mark(delta: int, kind: uuid.UUID | None = None, **fields: object) -> ClockMark:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "clock_id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "kind_id": kind,
        "delta": delta,
        "note": None,
        "created_at": NOW,
    }
    values.update(fields)
    return ClockMark(**values)  # type: ignore[arg-type]


def test_clean_helpers() -> None:
    assert clean_line(None, 5, "name") is None
    assert clean_line("  a   b ", 5, "name") == "a b"
    assert clean_line("   ", 5, "name") is None
    with pytest.raises(ClockFieldError):
        clean_line("abcdef", 5, "name")
    assert clean_text(None, 5, "description") is None
    assert clean_text(" a\n\nb ", 10, "description") == "a\n\nb"
    with pytest.raises(ClockFieldError):
        clean_text("abcdef", 5, "description")
    assert clean_name(" Allarme ") == "Allarme"
    with pytest.raises(ClockFieldError):
        clean_name("   ")


def _settings(**fields: object) -> ClockSettings:
    values: dict[str, object] = {
        "description": None,
        "segments": 5,
        "color": MapColor.BLUE,
        "stage_labels": [],
        "closing_condition": None,
        "consequence": None,
        "forward_only": False,
        "mark_policy": None,
        "label_ids": [],
    }
    values.update(fields)
    return clean_settings(**values)  # type: ignore[arg-type]


def test_clean_settings() -> None:
    settings = _settings(stage_labels=["Uno", "", "Tre", " ", ""], description=" x ")
    assert settings.stage_labels == ("Uno", "", "Tre")
    assert settings.description == "x"
    for bad in (1, 17):
        with pytest.raises(ClockFieldError):
            _settings(segments=bad)
    with pytest.raises(ClockFieldError):
        _settings(segments=2, stage_labels=["a", "b", "c"])
    with pytest.raises(ClockFieldError):
        _settings(label_ids=[uuid.uuid4() for _ in range(7)])
    same = uuid.uuid4()
    with pytest.raises(ClockFieldError):
        _settings(label_ids=[same, same])


def test_ensure_helpers() -> None:
    known = uuid.uuid4()
    ensure_known([known], {known}, "k")
    with pytest.raises(UnknownClockItemError):
        ensure_known([uuid.uuid4()], {known}, "k")
    ensure_below(1, 2, "k")
    with pytest.raises(ClockLimitError):
        ensure_below(2, 2, "k")
    ensure_name_free("Jazz", ["Rock"], "k")
    with pytest.raises(ClockNameTakenError):
        ensure_name_free("jazz", ["JAZZ"], "k")


def test_settings_json_round_trip() -> None:
    settings = ClockSettings(
        description="d",
        segments=8,
        color=MapColor.GOLD,
        stage_labels=("a",),
        closing_condition="c",
        consequence="q",
        forward_only=True,
        mark_policy=MarkPolicy.EVERYONE,
        label_ids=(uuid.uuid4(),),
    )
    assert settings_from_json(settings_to_json(settings)) == settings
    assert settings_from_json({}) == ClockSettings()


def test_creation_state() -> None:
    rules = ClockRules(room_id=ROOM)
    assert creation_state(MASTER, rules, False) == ClockState.OPEN
    assert creation_state(PLAYER, rules, True) is None
    assert creation_state(PLAYER, replace(rules, open_policy=OpenPolicy.EVERYONE), True) == (
        ClockState.OPEN
    )
    propose = replace(rules, open_policy=OpenPolicy.PROPOSE)
    assert creation_state(PLAYER, propose, True) == ClockState.PROPOSED
    assert creation_state(PLAYER, propose, False) is None


def test_rights() -> None:
    clock = _clock()
    other = uuid.uuid4()
    rules = ClockRules(room_id=ROOM)
    assert can_manage_clock(clock, other, MASTER)
    assert can_manage_clock(clock, clock.created_by, PLAYER)
    assert not can_manage_clock(clock, other, PLAYER)
    assert can_mark_clock(clock, rules, other, MASTER)
    assert not can_mark_clock(clock, rules, clock.created_by, PLAYER)
    creator = replace(rules, mark_policy=MarkPolicy.MASTER_AND_CREATOR)
    assert can_mark_clock(clock, creator, clock.created_by, PLAYER)
    assert not can_mark_clock(clock, creator, other, PLAYER)
    everyone = replace(clock, mark_policy=MarkPolicy.EVERYONE)
    assert can_mark_clock(everyone, rules, other, PLAYER)


def test_kinds() -> None:
    def kind(who: KindWho) -> MarkKind:
        return MarkKind(uuid.uuid4(), ROOM, who.value, MapColor.RED, who, 0)

    master, players, everyone = kind(KindWho.MASTER), kind(KindWho.PLAYERS), kind(KindWho.EVERYONE)
    assert can_use_kind(master, MASTER) and not can_use_kind(master, PLAYER)
    assert can_use_kind(players, PLAYER) and not can_use_kind(players, MASTER)
    assert can_use_kind(everyone, PLAYER)
    kinds = [master, players, everyone]
    assert choose_kind(kinds, None, PLAYER) == players.id
    assert choose_kind(kinds, None, MASTER) == master.id
    assert choose_kind([], None, MASTER) is None
    assert choose_kind(kinds, everyone.id, PLAYER) == everyone.id
    with pytest.raises(UnknownClockItemError):
        choose_kind(kinds, uuid.uuid4(), PLAYER)
    with pytest.raises(MarkKindNotAllowedError):
        choose_kind(kinds, master.id, PLAYER)


def test_master_only_fields_and_visibility() -> None:
    ensure_settings_allowed(MASTER, ClockSettings(consequence="x"))
    ensure_settings_allowed(PLAYER, ClockSettings())
    with pytest.raises(MasterOnlyFieldError):
        ensure_settings_allowed(PLAYER, ClockSettings(consequence="x"))
    clock = _clock(consequence="Arriva la polizia")
    assert visible_clock(clock, MASTER).consequence == "Arriva la polizia"
    assert visible_clock(clock, PLAYER).consequence is None
    plain = _clock()
    assert visible_clock(plain, PLAYER) is plain
    template = ClockTemplate(uuid.uuid4(), ROOM, "T", ClockSettings(consequence="x"), 0, NOW)
    assert visible_template(template, PLAYER).settings.consequence is None
    assert visible_template(template, MASTER) is template


def test_is_clock_visible() -> None:
    other = uuid.uuid4()
    proposal = _clock(state=ClockState.PROPOSED)
    assert is_clock_visible(proposal, other, MASTER, [])
    assert is_clock_visible(proposal, proposal.created_by, PLAYER, [])
    assert not is_clock_visible(proposal, other, PLAYER, [other])
    hidden = _clock(visibility=DocumentVisibility.SELECTIVE)
    assert not is_clock_visible(hidden, other, PLAYER, [])
    assert is_clock_visible(hidden, other, PLAYER, [other])


def test_base_revision_and_audit() -> None:
    clock = _clock(revision=3)
    ensure_base_revision(clock, None)
    ensure_base_revision(clock, 3)
    with pytest.raises(StaleClockError):
        ensure_base_revision(clock, 2)
    editor, member = uuid.uuid4(), uuid.uuid4()
    assert clock_visibility_audit(clock, clock.visibility, editor, [], None) is None
    assert clock_visibility_audit(clock, clock.visibility, editor, [member], [member]) is None
    entry = clock_visibility_audit(clock, DocumentVisibility.SELECTIVE, editor, [], [member])
    assert entry is not None
    assert entry.details["selective_user_ids"] == [str(member)]
    kept = clock_visibility_audit(clock, DocumentVisibility.MASTER, editor, [member], None)
    assert kept is not None and kept.details["to"] == "master"


def test_apply_mark() -> None:
    rules = ClockRules(room_id=ROOM)
    clock = _clock(filled=2)
    assert apply_mark(clock, rules, 5).applied == 2
    assert apply_mark(clock, rules, 5).state == ClockState.CLOSED
    assert apply_mark(clock, rules, -1).state == ClockState.OPEN
    closed = _clock(filled=4, state=ClockState.CLOSED)
    assert apply_mark(closed, rules, -1).state == ClockState.OPEN
    with pytest.raises(ClockNotMarkableError):
        apply_mark(closed, rules, 1)
    with pytest.raises(ClockFieldError):
        apply_mark(clock, rules, 0)
    with pytest.raises(UnmarkNotAllowedError):
        apply_mark(clock, replace(rules, allow_unmark=False), -1)
    with pytest.raises(UnmarkNotAllowedError):
        apply_mark(replace(clock, forward_only=True), rules, -1)
    for state in (ClockState.PROPOSED, ClockState.LAPSED):
        with pytest.raises(ClockNotMarkableError):
            apply_mark(replace(clock, state=state), rules, 1)
    with pytest.raises(ClockNotMarkableError):
        apply_mark(replace(clock, archived_at=NOW), rules, 1)
    with pytest.raises(ClockNotMarkableError):
        apply_mark(clock, rules, 1, locked=True)


def test_undo_mark() -> None:
    clock = _clock(filled=4, state=ClockState.CLOSED)
    mark = _mark(2)
    outcome = undo_mark(clock, mark, mark.user_id, NOW)  # type: ignore[arg-type]
    assert (outcome.applied, outcome.filled, outcome.state) == (-2, 2, ClockState.OPEN)
    with pytest.raises(UndoNotAllowedError):
        undo_mark(clock, mark, uuid.uuid4(), NOW)
    with pytest.raises(UndoExpiredError):
        undo_mark(clock, replace(mark, undone_at=NOW), mark.user_id, NOW)  # type: ignore[arg-type]
    late = NOW + UNDO_WINDOW + timedelta(seconds=1)
    with pytest.raises(UndoExpiredError):
        undo_mark(clock, mark, mark.user_id, late)  # type: ignore[arg-type]
    with pytest.raises(ClockNotMarkableError):
        undo_mark(replace(clock, state=ClockState.LAPSED), mark, mark.user_id, NOW)  # type: ignore[arg-type]


def test_resized() -> None:
    assert resized(_clock(filled=3), 3) == (3, ClockState.CLOSED)
    assert resized(_clock(filled=4, state=ClockState.CLOSED, segments=4), 6) == (4, ClockState.OPEN)
    assert resized(_clock(state=ClockState.PROPOSED), 6) == (0, ClockState.PROPOSED)


def test_segment_kinds() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    marks = [_mark(2, a), _mark(1, b), _mark(-1), _mark(3, b, undone_at=NOW), _mark(1, b)]
    assert segment_kinds(marks, 3) == [a, a, b]
    assert segment_kinds(marks, 1) == [a]
    assert segment_kinds(marks, 5) == [a, a, b, None, None]
    assert kind_counts([a, a, None]) == {a: 2, None: 1}


def test_history_helpers() -> None:
    clock = _clock()
    changed = replace(clock, name="Nuovo", consequence="x")
    assert edited_fields(clock, changed) == ["name", "consequence"]
    event = ClockEvent(
        uuid.uuid4(), clock.id, None, HistoryAction.EDITED, {"fields": ["name", "consequence"]}, NOW
    )
    assert visible_event(event, PLAYER).details["fields"] == ["name"]
    assert visible_event(event, MASTER) is event
    plain = replace(event, details={})
    assert visible_event(plain, PLAYER) is plain


def test_sequence() -> None:
    group = _group(GroupMode.SEQUENCE)
    first = _clock(group_id=group.id, group_position=0, state=ClockState.CLOSED)
    second = _clock(group_id=group.id, group_position=1)
    third = _clock(group_id=group.id, group_position=2)
    archived = _clock(group_id=group.id, group_position=1, archived_at=NOW)
    clocks = [third, second, first, archived]
    assert sequence_markable_id(clocks) == second.id
    assert not is_locked(second, group, clocks)
    assert is_locked(third, group, clocks)
    assert not is_locked(first, group, clocks)
    assert not is_locked(third, None, clocks)
    assert not is_locked(third, _group(GroupMode.FREE), clocks)
    assert sequence_markable_id([first]) is None


def test_race() -> None:
    group = _group(GroupMode.RACE)
    escape = _clock(group_id=group.id, group_position=0, state=ClockState.CLOSED)
    caught = _clock(group_id=group.id, group_position=1)
    assert pending_ids(group, [escape, caught]) == [escape.id]
    assert end_group(group, [escape, caught]).result == {
        "winner_ids": [str(escape.id)],
        "tie": False,
    }
    both = [escape, replace(caught, state=ClockState.CLOSED)]
    assert end_group(group, both).result["tie"] is True
    with pytest.raises(GroupNotEndableError):
        end_group(group, [caught])
    assert pending_ids(replace(group, ended_at=NOW), [escape]) == []
    assert pending_ids(_group(GroupMode.FREE), [escape]) == []


def test_turn() -> None:
    group = _group(GroupMode.TURN)
    bomb = _clock(group_position=0, state=ClockState.CLOSED, decisive_label="Svolta positiva")
    plain_closed = _clock(group_position=1, state=ClockState.CLOSED)
    other = _clock(group_position=2)
    archived = _clock(group_position=3, archived_at=NOW)
    clocks = [bomb, plain_closed, other, archived]
    assert pending_ids(group, clocks) == [bomb.id]
    ended = end_group(group, clocks)
    assert ended.result == {"outcomes": [{"clock_id": str(bomb.id), "label": "Svolta positiva"}]}
    assert ended.lapsed_ids == [other.id]


def test_visible_result() -> None:
    shown, hidden = uuid.uuid4(), uuid.uuid4()
    assert visible_result(None, []) is None
    race = {"winner_ids": [str(shown), str(hidden)], "tie": True}
    assert visible_result(race, [shown]) == {"winner_ids": [str(shown)], "tie": True}
    turn = {"outcomes": [{"clock_id": str(hidden), "label": "x"}]}
    assert visible_result(turn, [shown]) == {"outcomes": []}

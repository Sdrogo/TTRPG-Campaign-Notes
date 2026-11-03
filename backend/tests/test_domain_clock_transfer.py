"""Clocks in the JSON export and the import (spec 61 Decision 27)."""

import uuid
from datetime import UTC, datetime
from typing import Any

from app.domain.clock_transfer import CLOCK_KEYS, clocks_to_json, plan_clock_import
from app.domain.clocks import (
    MAX_CLOCKS_PER_GROUP,
    MAX_LABELS_PER_ROOM,
    MAX_MARK_KINDS,
    Clock,
    ClockGroup,
    ClockLabel,
    ClockMark,
    ClockRules,
    ClockSettings,
    ClockSetup,
    ClockState,
    ClockTemplate,
    GroupMode,
    KindWho,
    MarkKind,
    MarkPolicy,
    OpenPolicy,
)
from app.domain.models import DocumentVisibility, RoomRole
from app.domain.relationship_maps import MapColor

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
ROOM = uuid.uuid4()
USER = uuid.uuid4()


def _clock(**fields: Any) -> Clock:
    base: dict[str, Any] = {
        "id": uuid.uuid4(),
        "room_id": ROOM,
        "name": "Allarme",
        "segments": 4,
        "color": MapColor.RED,
        "state": ClockState.OPEN,
        "visibility": DocumentVisibility.ROOM,
        "created_by": USER,
        "created_at": NOW,
        "updated_at": NOW,
        "position": 0,
    }
    base.update(fields)
    return Clock(**base)


def _group(mode: GroupMode = GroupMode.RACE, **fields: Any) -> ClockGroup:
    base: dict[str, Any] = {
        "id": uuid.uuid4(),
        "room_id": ROOM,
        "name": "Fuga",
        "mode": mode,
        "position": 0,
        "created_by": USER,
        "created_at": NOW,
        "updated_at": NOW,
    }
    base.update(fields)
    return ClockGroup(**base)


def _mark(clock: Clock, delta: int, kind: uuid.UUID | None = None) -> ClockMark:
    return ClockMark(uuid.uuid4(), clock.id, USER, kind, delta, None, NOW)


def _setup() -> tuple[ClockSetup, ClockLabel, MarkKind]:
    label = ClockLabel(uuid.uuid4(), ROOM, "Minaccia", MapColor.RED, 0)
    kind = MarkKind(uuid.uuid4(), ROOM, "Danno", MapColor.GOLD, KindWho.PLAYERS, 0)
    template = ClockTemplate(
        uuid.uuid4(),
        ROOM,
        "Pericolo",
        ClockSettings(segments=8, consequence="Arrivano"),
        0,
        NOW,
    )
    rules = ClockRules(ROOM, OpenPolicy.PROPOSE, MarkPolicy.EVERYONE, False)
    return ClockSetup(rules, (label,), (kind,), (template,)), label, kind


# --- Export --------------------------------------------------------------------


def test_the_master_export_carries_rules_clocks_marks_and_groups() -> None:
    setup, label, kind = _setup()
    group = _group()
    other = _group(name="Vuoto")
    document = uuid.uuid4()
    clock = _clock(
        filled=3,
        consequence="Le guardie",
        label_ids=(label.id,),
        group_id=group.id,
        group_position=0,
        document_id=document,
        mark_policy=MarkPolicy.MASTER,
        archived_at=NOW,
    )
    proposal = _clock(state=ClockState.PROPOSED, name="Mio")
    loose = _clock(name="Altro", document_id=uuid.uuid4())
    marks = {clock.id: [_mark(clock, 2, kind.id), _mark(clock, 1)]}

    data = clocks_to_json(
        setup,
        [clock, proposal, loose],
        [group, other],
        marks,
        {document: "0:0"},
        RoomRole.MASTER,
    )

    assert set(data) == set(CLOCK_KEYS)
    assert data["clock_rules"] == {
        "open_policy": "propose",
        "mark_policy": "everyone",
        "allow_unmark": False,
        "labels": [{"id": str(label.id), "name": "Minaccia", "color": "red"}],
        "mark_kinds": [{"id": str(kind.id), "name": "Danno", "color": "gold", "who": "players"}],
    }
    assert data["clock_templates"][0]["settings"]["consequence"] == "Arrivano"
    first, second = data["clocks"]
    assert first["consequence"] == "Le guardie"
    assert first["document_id"] == str(document) and second["document_id"] is None
    assert first["archived"] is True and first["mark_policy"] == "master"
    assert first["group_id"] == str(group.id) and second["group_id"] is None
    assert sorted(first["marks"], key=lambda m: m["count"]) == [
        {"kind_id": None, "count": 1},
        {"kind_id": str(kind.id), "count": 2},
    ]
    assert second["mark_policy"] is None and second["marks"] == []
    assert data["clock_groups"] == [
        {"id": str(group.id), "name": "Fuga", "mode": "race", "ended": False}
    ]


def test_a_player_export_has_no_consequence() -> None:
    setup, _label, _kind = _setup()
    data = clocks_to_json(setup, [_clock(consequence="Segreto")], [], {}, {}, RoomRole.PLAYER)
    assert data["clocks"][0]["consequence"] is None
    assert data["clock_templates"][0]["settings"]["consequence"] is None


# --- Import --------------------------------------------------------------------


def _ids() -> Any:
    counter = iter(range(10_000))
    return lambda: uuid.UUID(int=next(counter) + 1)


def _plan(
    files: list[dict[str, Any]],
    documents: list[dict[str, uuid.UUID]] | None = None,
    *,
    labels: tuple[ClockLabel, ...] = (),
    kinds: tuple[MarkKind, ...] = (),
    clocks_left: int = 100,
    groups_left: int = 100,
) -> Any:
    return plan_clock_import(
        files,
        documents if documents is not None else [{} for _ in files],
        ROOM,
        USER,
        NOW,
        labels,
        kinds,
        clocks_left,
        groups_left,
        10,
        _ids(),
    )


def test_an_export_comes_back_into_another_room() -> None:
    setup, label, kind = _setup()
    group = _group(GroupMode.TURN)
    document = uuid.uuid4()
    clock = _clock(
        filled=4,
        state=ClockState.CLOSED,
        label_ids=(label.id,),
        group_id=group.id,
        group_position=1,
        decisive_label="Vince",
        document_id=document,
        visibility=DocumentVisibility.SELECTIVE,
        stage_labels=("a", "b"),
    )
    marks = {clock.id: [_mark(clock, 3, kind.id), _mark(clock, 1)]}
    data = clocks_to_json(setup, [clock], [group], marks, {document: "0:0"}, RoomRole.MASTER)
    in_room = uuid.uuid4()
    existing = ClockLabel(uuid.uuid4(), ROOM, "MINACCIA", MapColor.BLUE, 0)

    plan = _plan([data], [{str(document): in_room}], labels=(existing,))

    assert plan.labels == ()
    assert [k.name for k in plan.kinds] == ["Danno"] and plan.kinds[0].who == KindWho.PLAYERS
    assert [(g.name, g.mode) for g in plan.groups] == [("Fuga", GroupMode.TURN)]
    (made,) = plan.clocks
    assert made.label_ids == (existing.id,)
    assert made.group_id == plan.groups[0].id and made.group_position == 1
    assert made.decisive_label == "Vince"
    assert made.document_id == in_room
    assert made.visibility == DocumentVisibility.PRIVATE
    assert made.position == 10 and made.created_by == USER
    assert made.filled == 4 and made.state == ClockState.CLOSED
    assert made.stage_labels == ("a", "b")
    assert sorted((m.delta, m.kind_id) for m in plan.marks if m.kind_id) == [(3, plan.kinds[0].id)]
    assert sum(m.delta for m in plan.marks) == 4
    assert plan.skipped == 0


def test_unreadable_entries_are_skipped_alone() -> None:
    files: list[dict[str, Any]] = [
        {"clock_rules": "nope"},
        {"clocks": "nope"},
        {
            "clock_rules": {
                "labels": [
                    "x",
                    {"id": 3, "name": "Bad"},
                    {"id": "l0", "name": "  "},
                    {"id": "l1", "name": "Ok", "color": "plaid"},
                    {"id": "l2", "name": "Fine"},
                ],
                "mark_kinds": [{"id": "k1", "name": ""}, {"id": "k2", "name": "Colpo"}],
            },
            "clock_groups": [
                "x",
                {"id": "g0", "name": ""},
                {"name": "Senza id"},
                {"id": "g1", "name": "Free", "mode": "free"},
            ],
            "clocks": [
                "x",
                {"name": "Proposta", "state": "proposed"},
                {"name": "Grande", "segments": 99},
                {"name": "Bool", "segments": True},
                {"name": "", "segments": 4},
                {"name": "Marks", "marks": ["x"]},
                {
                    "name": "Buono",
                    "label_ids": ["l2", "missing", "l2"],
                    "group_id": "g1",
                    "decisive_label": "ignored",
                    "mark_policy": "everyone",
                    "forward_only": True,
                    "archived": True,
                    "state": "lapsed",
                    "marks": [
                        {"kind_id": "k2", "count": 2},
                        {"kind_id": "gone", "count": 1},
                        {"count": 0},
                        {"count": 50},
                    ],
                },
            ],
        },
    ]

    plan = _plan(files)

    assert [label.name for label in plan.labels] == ["Fine"]
    assert [kind.name for kind in plan.kinds] == ["Colpo"]
    assert [group.name for group in plan.groups] == ["Free"]
    (made,) = plan.clocks
    assert made.name == "Buono" and plan.skipped == 6
    assert made.label_ids == (plan.labels[0].id,)
    assert made.decisive_label is None and made.group_position == 0
    assert made.mark_policy == MarkPolicy.EVERYONE and made.forward_only
    assert made.archived_at == NOW and made.state == ClockState.LAPSED
    assert [(m.kind_id, m.delta) for m in plan.marks] == [
        (plan.kinds[0].id, 2),
        (None, 1),
        (None, 3),
    ]
    assert made.filled == 6


def test_the_caps_hold() -> None:
    labels = tuple(
        ClockLabel(uuid.uuid4(), ROOM, f"L{i}", MapColor.DEFAULT, i)
        for i in range(MAX_LABELS_PER_ROOM)
    )
    kinds = tuple(
        MarkKind(uuid.uuid4(), ROOM, f"K{i}", MapColor.DEFAULT, KindWho.EVERYONE, i)
        for i in range(MAX_MARK_KINDS)
    )
    file: dict[str, Any] = {
        "clock_rules": {
            "labels": [{"id": "n", "name": "Nuova"}, {"id": "o", "name": "l1"}],
            "mark_kinds": [{"id": "n", "name": "Nuovo"}, {"id": "o", "name": "k2"}],
        },
        "clock_groups": [{"id": "g1", "name": "A"}, {"id": "g2", "name": "B"}],
        "clocks": [
            {"name": f"C{i}", "group_id": "g1", "label_ids": ["n", "o"]}
            for i in range(MAX_CLOCKS_PER_GROUP + 2)
        ],
    }

    plan = _plan([file], labels=labels, kinds=kinds, groups_left=1, clocks_left=13)

    assert plan.labels == () and plan.kinds == ()
    assert [group.name for group in plan.groups] == ["A"]
    assert len(plan.clocks) == 13 and plan.skipped == 1
    grouped = [clock for clock in plan.clocks if clock.group_id is not None]
    assert len(grouped) == MAX_CLOCKS_PER_GROUP
    assert plan.clocks[-1].group_id is None and plan.clocks[-1].group_position is None
    assert plan.clocks[0].label_ids == (labels[1].id,)


def test_a_full_clock_closes_and_an_empty_file_plans_nothing() -> None:
    plan = _plan([{"clocks": [{"name": "Pieno", "segments": 2, "marks": [{"count": 2}]}]}, {}])
    assert plan.clocks[0].state == ClockState.CLOSED
    assert plan.clocks[0].visibility == DocumentVisibility.ROOM

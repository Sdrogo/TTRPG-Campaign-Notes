import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.domain.geographic_maps import Area, GeoBoard, LabelSide, Link, LinkEnd, Pin
from app.domain.import_files import ImportFile, ImportRefusedError, parse_file
from app.domain.imports import validate_files
from app.domain.map_transfer import (
    UnreadableMapError,
    map_name,
    plan_map,
    read_map,
)
from app.domain.models import DocumentVisibility
from app.domain.relationship_maps import (
    ArrowDirection,
    ArrowEnd,
    Board,
    CardSize,
    MapArrow,
    MapCard,
    MapColor,
    MapKind,
    RelationshipMap,
)
from app.domain.room_copy import SourceMap, copy_map

NOW = datetime(2026, 10, 19, tzinfo=UTC)


def _card(document_id: uuid.UUID | None = None, text: str | None = None) -> MapCard:
    return MapCard(
        id=uuid.uuid4(),
        document_id=document_id,
        text=text,
        group_id=None,
        caption=None,
        size=CardSize.NORMAL,
        master_only=False,
        color=MapColor.DEFAULT,
        struck=False,
        x=0,
        y=0,
    )


def _arrow(from_end: ArrowEnd, to_end: ArrowEnd) -> MapArrow:
    return MapArrow(
        id=uuid.uuid4(),
        from_end=from_end,
        to_end=to_end,
        direction=ArrowDirection.FORWARD,
        label=None,
        reverse_label=None,
        color=MapColor.DEFAULT,
        master_only=False,
    )


def _map(**fields: Any) -> RelationshipMap:
    return RelationshipMap(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        name="Court",
        description="",
        visibility=DocumentVisibility.ROOM,
        created_by=uuid.uuid4(),
        created_at=NOW,
        updated_at=NOW,
        **fields,
    )


def test_a_copied_map_leaves_out_what_points_outside_the_copy() -> None:
    kept, gone = uuid.uuid4(), uuid.uuid4()
    kept_card, gone_card = _card(kept), _card(gone)
    area_kept = Area(
        uuid.uuid4(),
        None,
        "Square",
        None,
        None,
        ((0, 0), (1, 0), (1, 1)),
        MapColor.DEFAULT,
        False,
        True,
        False,
    )
    area_gone = Area(
        uuid.uuid4(),
        gone,
        None,
        None,
        None,
        ((0, 0), (1, 0), (1, 1)),
        MapColor.DEFAULT,
        False,
        True,
        False,
    )
    pin_gone = Pin(uuid.uuid4(), gone, None, None, 1, 1, LabelSide.RIGHT, MapColor.DEFAULT, False)
    link = Link(
        uuid.uuid4(),
        LinkEnd(area_id=area_kept.id),
        LinkEnd(pin_id=pin_gone.id),
        ArrowDirection.NONE,
        None,
        None,
        MapColor.DEFAULT,
        False,
    )
    source = SourceMap(
        map=_map(kind=MapKind.GEOGRAPHIC, plane_width=100, plane_height=100),
        board=Board(
            cards=[kept_card, gone_card],
            arrows=[_arrow(ArrowEnd(card_id=kept_card.id), ArrowEnd(card_id=gone_card.id))],
        ),
        geo=GeoBoard(areas=[area_kept, area_gone], pins=[pin_gone], links=[link]),
        linked_document_ids=(kept, gone),
    )
    new_kept = uuid.uuid4()

    copied = copy_map(source, uuid.uuid4(), uuid.uuid4(), {kept: new_kept}, {})

    assert [card.document_id for card in copied.board.cards] == [new_kept]
    assert copied.board.arrows == []
    assert [area.name for area in copied.geo.areas] == ["Square"]
    assert copied.geo.pins == [] and copied.geo.links == []
    assert copied.linked_document_ids == (new_kept,)


def _read(**fields: Any) -> Any:
    return read_map({"id": str(uuid.uuid4()), "name": "Board", **fields})


@pytest.mark.parametrize(
    "fields",
    [
        {"cards": "not a list"},
        {"cards": ["not an object"]},
        {"cards": [{"id": "nope", "x": 0, "y": 0}]},
        {"cards": [{"id": str(uuid.uuid4()), "x": True, "y": 0}]},
        {"cards": [{"id": str(uuid.uuid4()), "x": float("inf"), "y": 0}]},
        {"cards": [{"id": str(uuid.uuid4()), "x": 0, "y": 0, "color": "plaid"}]},
        {"cards": [{"id": str(uuid.uuid4()), "x": 0, "y": 0, "text": 3}]},
        {"plane_width": "wide"},
        {"plane_width": True},
        {"arrows": [{"id": str(uuid.uuid4()), "from_end": {}, "to_end": {}}]},
        {"links": [{"id": str(uuid.uuid4()), "from_end": {}, "to_end": {}}]},
        {"areas": [{"id": str(uuid.uuid4()), "points": [[0, 0, 0]]}]},
        {"kind": "mention"},
    ],
)
def test_a_map_with_a_field_of_the_wrong_kind_is_unreadable(fields: dict[str, Any]) -> None:
    with pytest.raises(UnreadableMapError):
        _read(**fields)


def test_a_map_reads_with_defaults_and_names_itself_even_when_unreadable() -> None:
    read = _read(plane_width=500, cards=[{"id": str(uuid.uuid4()), "text": "Hi", "x": 1, "y": 2}])

    assert read.kind is MapKind.FREE and read.plane_width == 500
    assert read.board.cards[0].color is MapColor.DEFAULT
    assert map_name({"name": "  Court "}) == "Court"
    assert map_name("nope") == "" and map_name({"name": 3}) == ""


def test_a_players_master_only_link_is_left_out() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()
    read = _read(
        kind="geographic",
        pins=[
            {"id": str(first), "name": "A", "x": 1, "y": 1},
            {"id": str(second), "name": "B", "x": 2, "y": 2},
        ],
        links=[
            {
                "id": str(uuid.uuid4()),
                "from_end": {"pin_id": str(first)},
                "to_end": {"pin_id": str(second)},
                "master_only": True,
            }
        ],
    )

    planned = plan_map(
        read, "0:map:0", "f.json", (DocumentVisibility.ROOM, False), {}, set(), False
    )

    assert planned.master_only_dropped == 1 and planned.geo.links == []
    assert planned.document_count == 0


def test_maps_must_be_a_list_of_objects_and_within_the_cap() -> None:
    for maps in ('"x"', '["x"]'):
        with pytest.raises(ImportRefusedError):
            parse_file("a.json", f'{{"documents": [{{"name": "A"}}], "maps": {maps}}}'.encode())
    file = parse_file("a.json", b'{"documents": [{"name": "A"}]}')
    many = ImportFile("a.json", file.documents, maps=tuple({} for _ in range(101)))

    with pytest.raises(ImportRefusedError) as raised:
        validate_files([many])

    assert raised.value.key == "errors.import.tooManyMaps"

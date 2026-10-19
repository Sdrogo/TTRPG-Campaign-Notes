"""A geographic map as a JSON file (spec 38_3): reading a file into a new
map's content with Documents matched by name, and writing a map back."""

import uuid

import pytest

from app.domain.geographic_maps import (
    MAX_AREAS_PER_MAP,
    MAX_LINKS_PER_MAP,
    MAX_PINS_PER_MAP,
    Area,
    GeoBoard,
    InvalidPlaneError,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
)
from app.domain.map_import import (
    FILE_KIND,
    SCHEMA_VERSION,
    ImportedArea,
    ImportedLink,
    ImportedPin,
    MapFile,
    MapImportError,
    document_index,
    export_map_file,
    plan_map_import,
)
from app.domain.models import Document, DocumentVisibility, RoomRole
from app.domain.relationship_maps import (
    ArrowDirection,
    MapColor,
    MapLimitError,
    MapTextTooLongError,
    MasterOnlyNotAllowedError,
)

SQUARE = ((10.0, 10.0), (110.0, 10.0), (110.0, 110.0), (10.0, 110.0))
ROOM_ID = uuid.uuid4()


def _document(name: str) -> Document:
    return Document(
        id=uuid.uuid4(),
        room_id=ROOM_ID,
        name=name,
        description="",
        visibility=DocumentVisibility.ROOM,
        created_by=uuid.uuid4(),
    )


def _file(**fields: object) -> MapFile:
    values: dict[str, object] = {"name": "Shibuya", "plane_width": 1000, "plane_height": 800}
    values.update(fields)
    return MapFile(**values)  # type: ignore[arg-type]


def test_document_index_groups_documents_by_name_ignoring_case() -> None:
    first, second = _document("Dōgenzaka"), _document(" dōgenzaka ")
    assert document_index([first, second]) == {"dōgenzaka": [first.id, second.id]}


def test_an_import_binds_names_to_documents_and_keeps_the_rest_as_labels() -> None:
    hachiko, sky, twin_a, twin_b = (
        _document("Statua di Hachikō"),
        _document("Shibuya Sky"),
        _document("Gemello"),
        _document("gemello"),
    )
    map_file = _file(
        description="Le zone",
        areas=[
            ImportedArea(key="dogen", points=SQUARE, document="Dōgenzaka", note="Salita"),
            ImportedArea(key="park", points=SQUARE, name="Yoyogi", subtitle="Parco", dashed=True),
        ],
        pins=[
            ImportedPin(key="hachiko", x=5, y=5, document="statua di hachikō"),
            ImportedPin(key="again", x=6, y=6, document="Statua di Hachikō"),
            ImportedPin(key="sky", x=7, y=7, document="SHIBUYA SKY", label_side=LabelSide.LEFT),
            ImportedPin(key="twin", x=8, y=8, document="Gemello"),
            ImportedPin(key="twin2", x=9, y=9, document="Gemello"),
            ImportedPin(key="lost", x=9, y=9, document="Dōgenzaka"),
            ImportedPin(key="blank", x=9, y=9, document="  ", name="Crocevia"),
            ImportedPin(key="long", x=9, y=9, document="x" * 120),
        ],
        links=[
            ImportedLink(
                from_key="sky",
                to_key="dogen",
                direction=ArrowDirection.BOTH,
                label="vede",
                reverse_label="è visto",
                color=MapColor.RED,
                bend=-80,
            )
        ],
    )

    planned = plan_map_import(map_file, [hachiko, sky, twin_a, twin_b], RoomRole.MASTER)

    assert (planned.plane_width, planned.plane_height) == (1000, 800)
    report = planned.report
    assert (report.areas, report.pins, report.links, report.matched) == (2, 8, 1, 2)
    assert report.not_found == ("Dōgenzaka", "x" * 120)
    assert report.ambiguous == ("Gemello",)
    assert report.repeated == ("Statua di Hachikō",)
    dogen, park = planned.plan.areas
    assert (dogen.document_id, dogen.name, dogen.note) == (None, "Dōgenzaka", "Salita")
    assert (park.name, park.subtitle, park.dashed, park.filled) == ("Yoyogi", "Parco", True, True)
    pins = {pin.name or str(pin.document_id): pin for pin in planned.plan.pins}
    assert pins[str(hachiko.id)].note is None
    assert pins[str(sky.id)].label_side == LabelSide.LEFT
    assert pins["Statua di Hachikō"].document_id is None
    assert pins["Crocevia"].document_id is None
    assert pins["x" * 80].document_id is None
    (link,) = planned.plan.links
    # Ids follow the file's order, which is the order the map is read back in.
    ids = [area.id for area in planned.plan.areas] + [pin.id for pin in planned.plan.pins]
    ids.append(link.id)
    assert ids == sorted(ids)
    assert link.from_end == LinkEnd(pin_id=pins[str(sky.id)].id)
    assert link.to_end == LinkEnd(area_id=dogen.id)
    assert (link.label, link.reverse_label, link.bend) == ("vede", "è visto", -80)


def test_a_name_matching_no_visible_document_is_not_found() -> None:
    planned = plan_map_import(
        _file(pins=[ImportedPin(key="elysium", x=1, y=1, document="Elysium")]), [], RoomRole.PLAYER
    )
    assert planned.report.not_found == ("Elysium",)
    assert planned.plan.pins[0].name == "Elysium"


@pytest.mark.parametrize(
    ("map_file", "key"),
    [
        (
            _file(
                areas=[ImportedArea(key="a", points=SQUARE, name="A")],
                pins=[ImportedPin(key="a", x=1, y=1, name="B")],
            ),
            "errors.mapImport.duplicateKey",
        ),
        (
            _file(areas=[ImportedArea(key="a", points=SQUARE[:2], name="A")]),
            "errors.mapImport.invalidArea",
        ),
        (
            _file(areas=[ImportedArea(key="a", points=((0, 0), (5000, 0), (0, 10)), name="A")]),
            "errors.mapImport.invalidArea",
        ),
        (
            _file(areas=[ImportedArea(key="a", points=((0, 0), (5, 5), (10, 10)), name="A")]),
            "errors.mapImport.invalidArea",
        ),
        (
            _file(
                areas=[ImportedArea(key="a", points=((0, 0), (float("nan"), 0), (0, 10)), name="A")]
            ),
            "errors.mapImport.invalidArea",
        ),
        (_file(areas=[ImportedArea(key="a", points=SQUARE)]), "errors.mapImport.nameRequired"),
        (_file(pins=[ImportedPin(key="p", x=1, y=1, name=" ")]), "errors.mapImport.nameRequired"),
        (
            _file(pins=[ImportedPin(key="p", x=-1, y=1, name="P")]),
            "errors.mapImport.pinOutsidePlane",
        ),
        (
            _file(
                pins=[ImportedPin(key="p", x=1, y=1, name="P")],
                links=[ImportedLink(from_key="p", to_key="q")],
            ),
            "errors.mapImport.unknownKey",
        ),
        (
            _file(
                pins=[ImportedPin(key="p", x=1, y=1, name="P")],
                links=[ImportedLink(from_key="p", to_key="p")],
            ),
            "errors.mapImport.linkToItself",
        ),
    ],
)
def test_a_file_that_cant_become_a_map_is_refused(map_file: MapFile, key: str) -> None:
    with pytest.raises(MapImportError) as raised:
        plan_map_import(map_file, [], RoomRole.MASTER)
    assert str(raised.value) == key
    assert raised.value.params["item"] in {"a", "p", "q"}


@pytest.mark.parametrize(
    ("map_file", "error"),
    [
        (_file(plane_width=50), InvalidPlaneError),
        (
            _file(
                areas=[
                    ImportedArea(key=str(i), points=SQUARE, name="A")
                    for i in range(MAX_AREAS_PER_MAP + 1)
                ]
            ),
            MapLimitError,
        ),
        (
            _file(
                pins=[
                    ImportedPin(key=str(i), x=1, y=1, name="P") for i in range(MAX_PINS_PER_MAP + 1)
                ]
            ),
            MapLimitError,
        ),
        (
            _file(links=[ImportedLink(from_key="a", to_key="b")] * (MAX_LINKS_PER_MAP + 1)),
            MapLimitError,
        ),
        (_file(pins=[ImportedPin(key="p", x=1, y=1, name="P" * 81)]), MapTextTooLongError),
    ],
)
def test_the_plane_caps_and_texts_are_checked(map_file: MapFile, error: type[Exception]) -> None:
    with pytest.raises(error):
        plan_map_import(map_file, [], RoomRole.MASTER)


def test_a_player_cant_import_master_only_content() -> None:
    map_file = _file(pins=[ImportedPin(key="p", x=1, y=1, name="P", master_only=True)])
    with pytest.raises(MasterOnlyNotAllowedError):
        plan_map_import(map_file, [], RoomRole.PLAYER)
    assert plan_map_import(map_file, [], RoomRole.MASTER).plan.pins[0].master_only


def test_an_export_writes_the_map_as_an_import_file() -> None:
    dogen, sky = _document("Dōgenzaka"), _document("Shibuya Sky")
    area = Area(
        id=uuid.uuid4(),
        document_id=dogen.id,
        name=None,
        subtitle=None,
        note=None,
        points=((10.0, 10.5), (110.0, 10.0), (110.0, 110.0)),
        color=MapColor.BLUE,
        dashed=False,
        filled=True,
        master_only=False,
    )
    plain = Area(
        id=uuid.uuid4(),
        document_id=None,
        name="Yoyogi",
        subtitle="Parco",
        note="Silenzio",
        points=SQUARE,
        color=MapColor.EMERALD,
        dashed=True,
        filled=False,
        master_only=True,
    )
    bare = Area(
        id=uuid.uuid4(),
        document_id=None,
        name="Yoyogi",
        subtitle=None,
        note=None,
        points=SQUARE,
        color=MapColor.DEFAULT,
        dashed=False,
        filled=True,
        master_only=False,
    )
    pin = Pin(
        id=uuid.uuid4(),
        document_id=sky.id,
        name=None,
        note=None,
        x=7.0,
        y=7.25,
        label_side=LabelSide.ABOVE,
        color=MapColor.DEFAULT,
        master_only=False,
    )
    symbol = Pin(
        id=uuid.uuid4(),
        document_id=None,
        name="★",
        note=None,
        x=1.0,
        y=1.0,
        label_side=LabelSide.RIGHT,
        color=MapColor.GOLD,
        master_only=False,
    )
    links = [
        Link(
            id=uuid.uuid4(),
            from_end=LinkEnd(pin_id=pin.id),
            to_end=LinkEnd(area_id=area.id),
            direction=ArrowDirection.BOTH,
            label="vede",
            reverse_label="è visto",
            color=MapColor.RED,
            master_only=True,
            bend=-80.0,
        ),
        Link(
            id=uuid.uuid4(),
            from_end=LinkEnd(area_id=plain.id),
            to_end=LinkEnd(pin_id=symbol.id),
            direction=ArrowDirection.NONE,
            label=None,
            reverse_label=None,
            color=MapColor.DEFAULT,
            master_only=False,
        ),
    ]

    exported = export_map_file(
        "Shibuya",
        "Le zone",
        1000,
        800,
        GeoBoard(areas=[area, plain, bare], pins=[pin, symbol], links=links),
        {dogen.id: dogen.name, sky.id: sky.name},
    )

    assert exported == {
        "schema_version": SCHEMA_VERSION,
        "kind": FILE_KIND,
        "name": "Shibuya",
        "description": "Le zone",
        "plane": {"width": 1000, "height": 800},
        "areas": [
            {
                "key": "dogenzaka",
                "document": "Dōgenzaka",
                "points": [[10, 10.5], [110, 10], [110, 110]],
                "color": "blue",
                "filled": True,
                "dashed": False,
            },
            {
                "key": "yoyogi",
                "name": "Yoyogi",
                "note": "Silenzio",
                "master_only": True,
                "subtitle": "Parco",
                "points": [[10, 10], [110, 10], [110, 110], [10, 110]],
                "color": "emerald",
                "filled": False,
                "dashed": True,
            },
            {
                "key": "yoyogi-2",
                "name": "Yoyogi",
                "points": [[10, 10], [110, 10], [110, 110], [10, 110]],
                "color": "default",
                "filled": True,
                "dashed": False,
            },
        ],
        "pins": [
            {
                "key": "shibuya-sky",
                "document": "Shibuya Sky",
                "x": 7,
                "y": 7.25,
                "label_side": "above",
                "color": "default",
            },
            {"key": "pin", "name": "★", "x": 1, "y": 1, "label_side": "right", "color": "gold"},
        ],
        "links": [
            {
                "from": "shibuya-sky",
                "to": "dogenzaka",
                "direction": "both",
                "color": "red",
                "label": "vede",
                "reverse_label": "è visto",
                "bend": -80,
                "master_only": True,
            },
            {"from": "yoyogi", "to": "pin", "direction": "none", "color": "default"},
        ],
    }


def test_an_exported_map_imports_back_to_the_same_map() -> None:
    dogen = _document("Dōgenzaka")
    first = plan_map_import(
        _file(
            areas=[ImportedArea(key="d", points=SQUARE, document="Dōgenzaka", color=MapColor.BLUE)],
            pins=[ImportedPin(key="p", x=3, y=4, name="Bar", note="Aperto")],
            links=[ImportedLink(from_key="p", to_key="d", label="vicino", bend=12.5)],
        ),
        [dogen],
        RoomRole.MASTER,
    )
    board = GeoBoard(areas=first.plan.areas, pins=first.plan.pins, links=first.plan.links)
    exported = export_map_file("Shibuya", "", 1000, 800, board, {dogen.id: dogen.name})
    again = plan_map_import(
        _file(
            areas=[
                ImportedArea(
                    key=a["key"],
                    points=tuple(tuple(p) for p in a["points"]),
                    document=a.get("document"),
                    color=MapColor(a["color"]),
                )
                for a in exported["areas"]
            ],
            pins=[
                ImportedPin(
                    key=p["key"], x=p["x"], y=p["y"], name=p.get("name"), note=p.get("note")
                )
                for p in exported["pins"]
            ],
            links=[
                ImportedLink(
                    from_key=k["from"], to_key=k["to"], label=k.get("label"), bend=k.get("bend")
                )
                for k in exported["links"]
            ],
        ),
        [dogen],
        RoomRole.MASTER,
    )
    assert again.report == first.report
    assert [(a.document_id, a.points, a.color) for a in again.plan.areas] == [
        (a.document_id, a.points, a.color) for a in first.plan.areas
    ]
    assert [(p.name, p.note, p.x, p.y) for p in again.plan.pins] == [
        (p.name, p.note, p.x, p.y) for p in first.plan.pins
    ]
    assert [(k.label, k.bend) for k in again.plan.links] == [
        (k.label, k.bend) for k in first.plan.links
    ]

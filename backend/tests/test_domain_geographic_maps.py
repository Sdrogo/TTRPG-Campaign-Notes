"""Geographic maps (spec 38_1): what a viewer sees, how a save is checked and
planned, the plane and the background path."""

import math
import uuid

import pytest

from app.domain.geographic_maps import (
    DEFAULT_PLANE_HEIGHT,
    DEFAULT_PLANE_WIDTH,
    MAX_AREAS_PER_MAP,
    MAX_LINKS_PER_MAP,
    MAX_PINS_PER_MAP,
    Area,
    GeoBoard,
    GeoBoardPlan,
    InvalidPlaneError,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
    PlaceNameRequiredError,
    clean_plane,
    ensure_board_in_plane,
    geo_document_count,
    geo_document_counts,
    placed_document_ids,
    plan_background_path,
    plan_geo_board_edit,
    polygon_surface,
    visible_geo_board,
)
from app.domain.models import RoomRole
from app.domain.relationship_maps import (
    ArrowDirection,
    BoardDocumentNotFoundError,
    InvalidBoardError,
    MapColor,
    MapLimitError,
    MapTextTooLongError,
    MasterOnlyNotAllowedError,
)

W, H = 1000, 800
_EMPTY = GeoBoard()
SQUARE = ((10.0, 10.0), (110.0, 10.0), (110.0, 110.0), (10.0, 110.0))


def _area(document_id: uuid.UUID | None = None, **fields: object) -> Area:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "document_id": document_id,
        "name": None if document_id else "Bosco",
        "subtitle": None,
        "note": None,
        "points": SQUARE,
        "color": MapColor.EMERALD,
        "dashed": False,
        "filled": True,
        "master_only": False,
    }
    values.update(fields)
    return Area(**values)  # type: ignore[arg-type]


def _pin(document_id: uuid.UUID | None = None, **fields: object) -> Pin:
    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "document_id": document_id,
        "name": None if document_id else "Shibuya 109",
        "note": None,
        "x": 50.0,
        "y": 60.0,
        "label_side": LabelSide.RIGHT,
        "color": MapColor.DEFAULT,
        "master_only": False,
    }
    values.update(fields)
    return Pin(**values)  # type: ignore[arg-type]


def _link(start: Area | Pin, end: Area | Pin, **fields: object) -> Link:
    def link_end(item: Area | Pin) -> LinkEnd:
        return LinkEnd(area_id=item.id) if isinstance(item, Area) else LinkEnd(pin_id=item.id)

    values: dict[str, object] = {
        "id": uuid.uuid4(),
        "from_end": link_end(start),
        "to_end": link_end(end),
        "direction": ArrowDirection.FORWARD,
        "label": "la finestra",
        "reverse_label": None,
        "color": MapColor.RED,
        "master_only": False,
    }
    values.update(fields)
    return Link(**values)  # type: ignore[arg-type]


def _plan(
    submitted: GeoBoard,
    current: GeoBoard = _EMPTY,
    role: RoomRole = RoomRole.MASTER,
    visible: set[uuid.UUID] | None = None,
    foreign: frozenset[uuid.UUID] = frozenset(),
) -> GeoBoardPlan:
    ids = (
        visible
        if visible is not None
        else set(
            placed_document_ids(
                [*current.areas, *submitted.areas], [*current.pins, *submitted.pins]
            )
        )
    )
    shown = visible_geo_board(current, ids, role)
    return plan_geo_board_edit(current, shown, submitted, role, ids, W, H, foreign)


# --- The plane and the background ---------------------------------------------


def test_clean_plane_defaults_checks_and_refuses() -> None:
    assert clean_plane(None, None) == (DEFAULT_PLANE_WIDTH, DEFAULT_PLANE_HEIGHT)
    assert clean_plane(100, 20_000) == (100, 20_000)
    for width, height in ((99, 500), (500, 20_001), (None, 500), (500, None)):
        with pytest.raises(InvalidPlaneError):
            clean_plane(width, height)


def test_background_paths_are_fresh_per_upload() -> None:
    room_id, map_id = uuid.uuid4(), uuid.uuid4()
    first = plan_background_path(room_id, map_id, ".webp")
    assert first.startswith(f"map-backgrounds/{room_id}/{map_id}/")
    assert first.endswith(".webp")
    assert first != plan_background_path(room_id, map_id, ".webp")


def test_ensure_board_in_plane_counts_areas_and_pins() -> None:
    board = GeoBoard(areas=[_area()], pins=[_pin(x=900.0, y=50.0)])
    ensure_board_in_plane(board, 1000, 800)
    with pytest.raises(InvalidPlaneError):
        ensure_board_in_plane(board, 800, 800)  # the pin falls out
    with pytest.raises(InvalidPlaneError):
        ensure_board_in_plane(GeoBoard(areas=[_area()]), 100, 800)  # a corner falls out


def test_polygon_surface() -> None:
    assert polygon_surface(SQUARE) == 10_000
    assert polygon_surface(((0, 0), (10, 10), (20, 20))) == 0


# --- What a viewer sees -------------------------------------------------------


def test_a_hidden_document_takes_its_area_pin_and_links_away() -> None:
    seen, hidden = uuid.uuid4(), uuid.uuid4()
    zone = _area(seen)
    secret = _pin(hidden)
    plain = _pin()
    board = GeoBoard(
        areas=[zone],
        pins=[secret, plain],
        links=[_link(zone, secret), _link(zone, plain)],
    )
    shown = visible_geo_board(board, {seen}, RoomRole.PLAYER)
    assert shown.areas == [zone]
    assert shown.pins == [plain]
    assert [link.to_end.pin_id for link in shown.links] == [plain.id]
    assert geo_document_count(board, {seen}) == 1
    assert geo_document_counts({uuid.uuid4(): board}, {seen, hidden}) != {}


def test_master_only_items_and_links_show_to_masters_only() -> None:
    area = _area(master_only=True)
    pin = _pin(master_only=True)
    open_pin = _pin()
    open_area = _area()
    board = GeoBoard(
        areas=[area, open_area],
        pins=[pin, open_pin],
        links=[_link(open_area, open_pin, master_only=True), _link(area, open_pin)],
    )
    player = visible_geo_board(board, set(), RoomRole.PLAYER)
    assert player.areas == [open_area]
    assert player.pins == [open_pin]
    assert player.links == []
    master = visible_geo_board(board, set(), RoomRole.MASTER)
    assert len(master.links) == 2


# --- Saving -------------------------------------------------------------------


def test_a_save_cleans_texts_and_keeps_document_items_plain_of_them() -> None:
    document_id = uuid.uuid4()
    bound = _area(document_id, name="ignored", subtitle="ignored", note="ignored", master_only=True)
    plain = _area(name="  Meiji   Jingū ", subtitle=" Il bosco ", note=" sacro \n\n")
    pin = _pin(document_id=uuid.uuid4(), name="x", note="y", master_only=True)
    link = _link(
        plain,
        pin,
        direction=ArrowDirection.FORWARD,
        reverse_label="dropped",
        label_position=0.4,
        label_offset=12.0,
        bend=-40.0,
    )
    plan = _plan(GeoBoard(areas=[bound, plain], pins=[pin], links=[link]))
    cleaned_bound, cleaned_plain = plan.areas
    assert (cleaned_bound.name, cleaned_bound.subtitle, cleaned_bound.note) == (None, None, None)
    assert cleaned_bound.master_only is False
    assert (cleaned_plain.name, cleaned_plain.subtitle, cleaned_plain.note) == (
        "Meiji Jingū",
        "Il bosco",
        "sacro",
    )
    assert plan.pins[0].name is None and plan.pins[0].master_only is False
    cleaned_link = plan.links[0]
    assert cleaned_link.reverse_label is None
    assert (cleaned_link.label_position, cleaned_link.label_offset, cleaned_link.bend) == (
        0.4,
        12.0,
        -40.0,
    )


def test_a_two_way_link_keeps_its_reverse_label() -> None:
    a, b = _pin(), _pin()
    link = _link(a, b, direction=ArrowDirection.BOTH, reverse_label="ritorno")
    assert _plan(GeoBoard(pins=[a, b], links=[link])).links[0].reverse_label == "ritorno"


@pytest.mark.parametrize(
    "area",
    [
        _area(points=SQUARE[:2]),
        _area(points=tuple((float(i), float(i % 2)) for i in range(61))),
        _area(points=((10, 10), (2000, 10), (10, 100))),
        _area(points=((10, 10), (20, 20), (30, 30))),
        _area(points=((math.nan, 10), (20, 10), (20, 30))),
    ],
)
def test_bad_shapes_are_refused(area: Area) -> None:
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(areas=[area]))


def test_pins_outside_the_plane_and_wild_bends_are_refused() -> None:
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(pins=[_pin(x=-1.0)]))
    a, b = _pin(), _pin()
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(pins=[a, b], links=[_link(a, b, bend=9999.0)]))


def test_plain_items_need_a_name_and_short_texts() -> None:
    with pytest.raises(PlaceNameRequiredError):
        _plan(GeoBoard(pins=[_pin(name="   ")]))
    with pytest.raises(MapTextTooLongError):
        _plan(GeoBoard(areas=[_area(note="x" * 501)]))


def test_ids_are_unique_and_never_another_maps() -> None:
    pin = _pin()
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(pins=[pin, pin]))
    area = _area(id=pin.id)
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(areas=[area], pins=[pin]))
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(pins=[pin]), foreign=frozenset({pin.id}))


def test_hidden_items_cant_be_overwritten_and_are_kept() -> None:
    hidden_document = uuid.uuid4()
    hidden_pin = _pin(hidden_document)
    hidden_area = _area(uuid.uuid4())
    seen = _pin()
    hidden_link = _link(hidden_area, hidden_pin)
    current = GeoBoard(areas=[hidden_area], pins=[hidden_pin, seen], links=[hidden_link])
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(pins=[_pin(id=hidden_pin.id)]), current, RoomRole.PLAYER, visible=set())
    plan = _plan(GeoBoard(), current, RoomRole.PLAYER, visible=set())
    assert plan.delete_pin_ids == {seen.id}
    assert plan.delete_area_ids == frozenset()
    assert plan.delete_link_ids == frozenset()


def test_an_item_cant_change_document() -> None:
    area = _area(uuid.uuid4())
    pin = _pin(uuid.uuid4())
    current = GeoBoard(areas=[area], pins=[pin])
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(areas=[_area(uuid.uuid4(), id=area.id)], pins=[pin]), current)
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(areas=[area], pins=[_pin(id=pin.id)]), current)


def test_documents_must_be_seen_and_appear_once() -> None:
    document_id = uuid.uuid4()
    with pytest.raises(BoardDocumentNotFoundError):
        _plan(GeoBoard(pins=[_pin(document_id)]), visible=set())
    with pytest.raises(InvalidBoardError):
        _plan(GeoBoard(areas=[_area(document_id)], pins=[_pin(document_id)]))


def test_only_masters_mark_master_only() -> None:
    with pytest.raises(MasterOnlyNotAllowedError):
        _plan(GeoBoard(pins=[_pin(master_only=True)]), role=RoomRole.PLAYER)
    a, b = _pin(), _pin()
    with pytest.raises(MasterOnlyNotAllowedError):
        _plan(GeoBoard(pins=[a, b], links=[_link(a, b, master_only=True)]), role=RoomRole.PLAYER)


def test_link_ends_must_be_on_the_map_and_differ() -> None:
    a, b = _pin(), _pin()
    area = _area()
    for link in (
        _link(a, _pin()),
        _link(area, b, from_end=LinkEnd(area_id=uuid.uuid4())),
        _link(a, a),
        _link(a, b, from_end=LinkEnd()),
        _link(a, b, from_end=LinkEnd(area_id=area.id, pin_id=a.id)),
    ):
        with pytest.raises(InvalidBoardError):
            _plan(GeoBoard(areas=[area], pins=[a, b], links=[link]))
    plan = _plan(GeoBoard(areas=[area], pins=[a], links=[_link(area, a)]))
    assert len(plan.links) == 1


def test_caps_count_hidden_items_and_drop_links_that_go() -> None:
    with pytest.raises(MapLimitError):
        _plan(GeoBoard(areas=[_area() for _ in range(MAX_AREAS_PER_MAP + 1)]))
    with pytest.raises(MapLimitError):
        _plan(GeoBoard(pins=[_pin() for _ in range(MAX_PINS_PER_MAP + 1)]))
    a, b = _pin(), _pin()
    links = [_link(a, b) for _ in range(MAX_LINKS_PER_MAP + 1)]
    with pytest.raises(MapLimitError):
        _plan(GeoBoard(pins=[a, b], links=links))

    # A hidden link to a pin the editor deletes goes with it: not counted.
    hidden_document = uuid.uuid4()
    seen, hidden = _pin(), _pin(hidden_document)
    hidden_link = _link(seen, hidden, master_only=True)
    current = GeoBoard(pins=[seen, hidden], links=[hidden_link])
    c, d = _pin(), _pin()
    full = [_link(c, d) for _ in range(MAX_LINKS_PER_MAP)]
    plan = _plan(GeoBoard(pins=[c, d], links=full), current, RoomRole.PLAYER, visible=set())
    assert plan.delete_pin_ids == {seen.id}

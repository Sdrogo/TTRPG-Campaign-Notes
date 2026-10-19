"""Geographic maps (spec 38_1): a map of a Room on a flat plane, with areas
(zones, closed shapes), pins (places, points) and links between them. Areas
and pins may be bound to a Document. Like a free board (spec 28), a link
belongs to its map only.

Who may see what (Invariant 1, VR-07), the same rules as a free board:

- a map has the Comment levels with its creator as the "Owner" (spec 28
  Decision 3, `app.domain.relationship_maps`);
- an area or pin bound to a Document shows only when the viewer sees that
  Document; a Master-only plain one only for a Master (Decision 6);
- a link shows when both its ends show and, when Master-only, to a Master.

Editing (spec 28 Decision 12, spec 38 Decision 9): an editor sends the whole
map as they see it; whatever they don't see is left exactly as it is
(`plan_geo_board_edit`)."""

import math
import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.relationship_maps import (
    MAX_LABEL_LENGTH,
    ArrowDirection,
    BoardDocumentNotFoundError,
    InvalidBoardError,
    MapColor,
    MapLimitError,
    MasterOnlyNotAllowedError,
    clean_label_offset,
    clean_label_position,
    clean_line,
    clean_lines,
)

MAX_AREAS_PER_MAP = 60
MAX_PINS_PER_MAP = 300
MAX_LINKS_PER_MAP = 400
MIN_AREA_POINTS = 3
MAX_AREA_POINTS = 60
MAX_PLACE_NAME_LENGTH = 80
MAX_NOTE_LENGTH = 500
# How far a link's curve may bend away from the straight line, in plane units.
MAX_BEND = 5000.0
DEFAULT_PLANE_WIDTH = 2000
DEFAULT_PLANE_HEIGHT = 1400
MIN_PLANE_SIZE = 100
MAX_PLANE_SIZE = 20_000
# Below this an area's shape is a line, not a surface.
MIN_AREA_SURFACE = 1.0
MAP_BACKGROUND_PATH_PREFIX = "map-backgrounds"
# A street map needs more detail than a cover picture (the images' own limit
# is `app.domain.images.MAX_DIMENSION`).
MAX_BACKGROUND_DIMENSION = 4096


class LabelSide(StrEnum):
    """Which side of its point a pin's label is written on (Decision 4)."""

    LEFT = "left"
    RIGHT = "right"
    ABOVE = "above"
    BELOW = "below"


class InvalidPlaneError(DomainError):
    """A plane size outside `MIN_PLANE_SIZE` to `MAX_PLANE_SIZE`, or a
    geographic map asked for without one. Answered with 422."""


class WrongMapKindError(DomainError):
    """A geographic route was asked of a free map, or a free board route of
    a geographic one (Decision 1: a map's kind never changes). Answered with
    409."""


class PlaceNameRequiredError(DomainError):
    """An area or pin with no Document has no name once trimmed. Answered
    with 422."""


@dataclass(frozen=True)
class Area:
    """A closed shape on the plane (Decision 3), bound to a Document
    (`document_id`, its name and subtitle then follow the Document) or plain
    (`name`, `subtitle`, `note`). `points` are its corners in plane units, in
    order."""

    id: uuid.UUID
    document_id: uuid.UUID | None
    name: str | None
    subtitle: str | None
    note: str | None
    points: tuple[tuple[float, float], ...]
    color: MapColor
    dashed: bool
    filled: bool
    master_only: bool


@dataclass(frozen=True)
class Pin:
    """A point on the plane (Decision 4), bound to a Document or plain, with
    the side its label is written on."""

    id: uuid.UUID
    document_id: uuid.UUID | None
    name: str | None
    note: str | None
    x: float
    y: float
    label_side: LabelSide
    color: MapColor
    master_only: bool


@dataclass(frozen=True)
class LinkEnd:
    """One end of a link: an area or a pin, never both."""

    area_id: uuid.UUID | None = None
    pin_id: uuid.UUID | None = None

    @property
    def id(self) -> uuid.UUID:
        """The area's or the pin's id."""
        end = self.area_id if self.area_id is not None else self.pin_id
        assert end is not None
        return end


@dataclass(frozen=True)
class Link:
    """A link between two ends (Decision 5), with the labels, direction and
    label places of a free map's arrow (spec 28 Decision 5). `bend` is how
    far the curve leaves the straight line between the ends, in plane units
    (negative to the other side), or None for the default curve."""

    id: uuid.UUID
    from_end: LinkEnd
    to_end: LinkEnd
    direction: ArrowDirection
    label: str | None
    reverse_label: str | None
    color: MapColor
    master_only: bool
    bend: float | None = None
    label_position: float | None = None
    reverse_label_position: float | None = None
    label_offset: float | None = None
    reverse_label_offset: float | None = None


@dataclass(frozen=True)
class GeoBoard:
    """Everything on a geographic map: its areas, pins and links."""

    areas: Sequence[Area] = ()
    pins: Sequence[Pin] = ()
    links: Sequence[Link] = ()


@dataclass(frozen=True)
class GeoBoardPlan:
    """What a geographic map save writes: items to create or rewrite
    (`upsert`, the editor's whole visible map, cleaned) and ids to delete,
    per kind."""

    areas: Sequence[Area]
    pins: Sequence[Pin]
    links: Sequence[Link]
    delete_area_ids: Collection[uuid.UUID] = field(default_factory=frozenset)
    delete_pin_ids: Collection[uuid.UUID] = field(default_factory=frozenset)
    delete_link_ids: Collection[uuid.UUID] = field(default_factory=frozenset)


# --- The plane ----------------------------------------------------------------


def plan_background_path(room_id: uuid.UUID, map_id: uuid.UUID, extension: str) -> str:
    """A fresh random Storage name per upload, so a replaced background never
    serves a stale cached copy under the same URL."""
    return f"{MAP_BACKGROUND_PATH_PREFIX}/{room_id}/{map_id}/{uuid.uuid4()}{extension}"


def clean_plane(width: int | None, height: int | None) -> tuple[int, int]:
    """A plane size, `MIN_PLANE_SIZE` to `MAX_PLANE_SIZE` units each way
    (Decision 2); the defaults when none is sent. `InvalidPlaneError`
    otherwise."""
    if width is None and height is None:
        return DEFAULT_PLANE_WIDTH, DEFAULT_PLANE_HEIGHT
    if width is None or height is None:
        raise InvalidPlaneError("errors.map.invalidPlane")
    for side in (width, height):
        if not MIN_PLANE_SIZE <= side <= MAX_PLANE_SIZE:
            raise InvalidPlaneError("errors.map.invalidPlane")
    return width, height


def ensure_board_in_plane(board: GeoBoard, plane_width: int, plane_height: int) -> None:
    """A smaller plane may not leave anything of the map, hidden items
    included, outside it (Decision 9): `InvalidPlaneError`."""
    points = [point for area in board.areas for point in area.points]
    points.extend((pin.x, pin.y) for pin in board.pins)
    if any(not (0 <= x <= plane_width and 0 <= y <= plane_height) for x, y in points):
        raise InvalidPlaneError("errors.map.planeTooSmall")


# --- What a viewer sees on a map ----------------------------------------------


def visible_areas(
    areas: Iterable[Area], visible_document_ids: Collection[uuid.UUID], role: RoomRole
) -> list[Area]:
    """Decision 6: an area bound to a Document only when the viewer sees it,
    a Master-only plain one only for a Master. A hidden area is simply
    absent."""
    return [
        area
        for area in areas
        if (area.document_id in visible_document_ids if area.document_id is not None else True)
        and (not area.master_only or role == RoomRole.MASTER)
    ]


def visible_pins(
    pins: Iterable[Pin], visible_document_ids: Collection[uuid.UUID], role: RoomRole
) -> list[Pin]:
    """Decision 6, for pins, as `visible_areas`."""
    return [
        pin
        for pin in pins
        if (pin.document_id in visible_document_ids if pin.document_id is not None else True)
        and (not pin.master_only or role == RoomRole.MASTER)
    ]


def visible_links(
    links: Iterable[Link],
    shown_area_ids: Collection[uuid.UUID],
    shown_pin_ids: Collection[uuid.UUID],
    role: RoomRole,
) -> list[Link]:
    """Decisions 5 and 6: a link shows when both its ends do and, when
    Master-only, only to a Master."""

    def shows(end: LinkEnd) -> bool:
        """Whether that end is on the viewer's map."""
        if end.area_id is not None:
            return end.area_id in shown_area_ids
        return end.pin_id in shown_pin_ids

    return [
        link
        for link in links
        if shows(link.from_end)
        and shows(link.to_end)
        and (not link.master_only or role == RoomRole.MASTER)
    ]


def visible_geo_board(
    board: GeoBoard, visible_document_ids: Collection[uuid.UUID], role: RoomRole
) -> GeoBoard:
    """The map as one viewer sees it (Invariant 1): their areas and pins,
    then the links that follow from them."""
    areas = visible_areas(board.areas, visible_document_ids, role)
    pins = visible_pins(board.pins, visible_document_ids, role)
    links = visible_links(board.links, {area.id for area in areas}, {pin.id for pin in pins}, role)
    return GeoBoard(areas=areas, pins=pins, links=links)


def placed_document_ids(areas: Iterable[Area], pins: Iterable[Pin]) -> list[uuid.UUID]:
    """The Documents these areas and pins are bound to, in order."""
    placed: list[Area | Pin] = [*areas, *pins]
    return [item.document_id for item in placed if item.document_id is not None]


def geo_document_count(board: GeoBoard, visible_document_ids: Collection[uuid.UUID]) -> int:
    """For the list of maps: how many Documents the map shows the viewer
    (areas and pins), never counting one they can't see (VR-07)."""
    return sum(
        1
        for document_id in placed_document_ids(board.areas, board.pins)
        if document_id in visible_document_ids
    )


# --- Cleaning what is sent ----------------------------------------------------


def _ensure_in_plane(x: float, y: float, plane_width: int, plane_height: int) -> None:
    """422 for a point that isn't a finite number inside the plane."""
    if not (math.isfinite(x) and math.isfinite(y)):
        raise InvalidBoardError("errors.map.invalidBoard")
    if not (0 <= x <= plane_width and 0 <= y <= plane_height):
        raise InvalidBoardError("errors.map.invalidBoard")


def polygon_surface(points: Sequence[tuple[float, float]]) -> float:
    """The surface of the shape through `points` in order (shoelace
    formula), in square plane units; 0 for a line."""
    total = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def _clean_texts(
    document_id: uuid.UUID | None,
    name: str | None,
    note: str | None,
) -> tuple[str | None, str | None]:
    """The name and note an area or pin keeps: none when it is bound to a
    Document (they follow it); a plain one needs a name (422)."""
    if document_id is not None:
        return None, None
    clean_name = clean_line(name, MAX_PLACE_NAME_LENGTH, "placeName")
    if clean_name is None:
        raise PlaceNameRequiredError("errors.map.placeNameRequired")
    return clean_name, clean_lines(note, MAX_NOTE_LENGTH, "note")


def _clean_area(area: Area, plane_width: int, plane_height: int) -> Area:
    """An area with its corners checked (3 to 60, inside the plane, a real
    surface) and its texts cleaned; a Document's area keeps no texts and is
    never Master-only."""
    if not MIN_AREA_POINTS <= len(area.points) <= MAX_AREA_POINTS:
        raise InvalidBoardError("errors.map.invalidBoard")
    for x, y in area.points:
        _ensure_in_plane(x, y, plane_width, plane_height)
    if polygon_surface(area.points) < MIN_AREA_SURFACE:
        raise InvalidBoardError("errors.map.invalidBoard")
    name, note = _clean_texts(area.document_id, area.name, area.note)
    return Area(
        id=area.id,
        document_id=area.document_id,
        name=name,
        subtitle=(
            None
            if area.document_id is not None
            else clean_line(area.subtitle, MAX_PLACE_NAME_LENGTH, "subtitle")
        ),
        note=note,
        points=area.points,
        color=area.color,
        dashed=area.dashed,
        filled=area.filled,
        master_only=area.master_only and area.document_id is None,
    )


def _clean_pin(pin: Pin, plane_width: int, plane_height: int) -> Pin:
    """A pin inside the plane with its texts cleaned; a Document's pin keeps
    no texts and is never Master-only."""
    _ensure_in_plane(pin.x, pin.y, plane_width, plane_height)
    name, note = _clean_texts(pin.document_id, pin.name, pin.note)
    return Pin(
        id=pin.id,
        document_id=pin.document_id,
        name=name,
        note=note,
        x=pin.x,
        y=pin.y,
        label_side=pin.label_side,
        color=pin.color,
        master_only=pin.master_only and pin.document_id is None,
    )


def _clean_link(link: Link) -> Link:
    """A link with its labels cleaned (a reverse label only on a two-way
    link, a label's place only while it exists) and its bend in range."""
    label = clean_line(link.label, MAX_LABEL_LENGTH, "label")
    reverse_label = (
        clean_line(link.reverse_label, MAX_LABEL_LENGTH, "label")
        if link.direction == ArrowDirection.BOTH
        else None
    )
    label_position = clean_label_position(link.label_position, label)
    reverse_label_position = clean_label_position(link.reverse_label_position, reverse_label)
    if link.bend is not None and not (math.isfinite(link.bend) and abs(link.bend) <= MAX_BEND):
        raise InvalidBoardError("errors.map.invalidBoard")
    return Link(
        id=link.id,
        from_end=link.from_end,
        to_end=link.to_end,
        direction=link.direction,
        label=label,
        reverse_label=reverse_label,
        color=link.color,
        master_only=link.master_only,
        bend=link.bend,
        label_position=label_position,
        reverse_label_position=reverse_label_position,
        label_offset=clean_label_offset(link.label_offset, label_position),
        reverse_label_offset=clean_label_offset(link.reverse_label_offset, reverse_label_position),
    )


def _ensure_unique_ids(items: Sequence[Area] | Sequence[Pin] | Sequence[Link]) -> None:
    """422 when the same id is sent twice."""
    ids = [item.id for item in items]
    if len(ids) != len(set(ids)):
        raise InvalidBoardError("errors.map.invalidBoard")


def plan_geo_board_edit(
    current: GeoBoard,
    shown: GeoBoard,
    submitted: GeoBoard,
    editor_role: RoomRole,
    editor_visible_document_ids: Collection[uuid.UUID],
    plane_width: int,
    plane_height: int,
    foreign_ids: Collection[uuid.UUID] = frozenset(),
) -> GeoBoardPlan:
    """Applies the map an editor sends (`submitted`, the whole of what they
    see) to the map (spec 28 Decision 12, spec 38 Decision 9). `current` is
    everything on the map, `shown` the part this editor sees
    (`visible_geo_board`); `foreign_ids` the submitted ids already used by
    another map. What the editor sees and didn't send is deleted; what they
    don't see is never touched, read or counted as theirs.

    Refused: an id of something hidden from the editor or of another map
    (422, so a hidden item can't be overwritten by guessing its id); an area
    or pin that changes Document; a Document twice on the map, as an area or
    a pin; a Document the editor doesn't see or of another Room (404); a
    corner or point outside the plane, an area with fewer than 3 or more than
    60 corners or no surface, a plain area or pin with no name, a link end
    not on the resulting map or a link from an end to itself (422);
    Master-only content from anyone but a Master (403); more than the caps,
    counted over everything on the map (409)."""
    for items in (submitted.areas, submitted.pins, submitted.links):
        _ensure_unique_ids(items)

    every_id = (
        {area.id for area in current.areas}
        | {pin.id for pin in current.pins}
        | {link.id for link in current.links}
    )
    shown_areas = {area.id: area for area in shown.areas}
    shown_pins = {pin.id: pin for pin in shown.pins}
    shown_links = {link.id: link for link in shown.links}
    sent_ids = (
        [area.id for area in submitted.areas]
        + [pin.id for pin in submitted.pins]
        + [link.id for link in submitted.links]
    )
    if len(sent_ids) != len(set(sent_ids)) or set(sent_ids) & set(foreign_ids):
        raise InvalidBoardError("errors.map.invalidBoard")

    def ensure_not_hidden(item_id: uuid.UUID, shown_ids: Collection[uuid.UUID]) -> None:
        """An id already on the map must be one the editor sees, as the same
        kind of thing."""
        if item_id in every_id and item_id not in shown_ids:
            raise InvalidBoardError("errors.map.invalidBoard")

    for area in submitted.areas:
        ensure_not_hidden(area.id, shown_areas)
    for pin in submitted.pins:
        ensure_not_hidden(pin.id, shown_pins)
    for link in submitted.links:
        ensure_not_hidden(link.id, shown_links)

    areas = [_clean_area(area, plane_width, plane_height) for area in submitted.areas]
    pins = [_clean_pin(pin, plane_width, plane_height) for pin in submitted.pins]
    links = [_clean_link(link) for link in submitted.links]

    is_master = editor_role == RoomRole.MASTER
    hidden_areas = [area for area in current.areas if area.id not in shown_areas]
    hidden_pins = [pin for pin in current.pins if pin.id not in shown_pins]
    hidden_links = [link for link in current.links if link.id not in shown_links]

    documents_on_map = placed_document_ids(hidden_areas, hidden_pins)
    for area in areas:
        before = shown_areas.get(area.id)
        if before is not None and before.document_id != area.document_id:
            raise InvalidBoardError("errors.map.invalidBoard")
    for pin in pins:
        before_pin = shown_pins.get(pin.id)
        if before_pin is not None and before_pin.document_id != pin.document_id:
            raise InvalidBoardError("errors.map.invalidBoard")
    placed: list[Area | Pin] = [*areas, *pins]
    for item in placed:
        if item.document_id is not None:
            if item.document_id not in editor_visible_document_ids:
                raise BoardDocumentNotFoundError("errors.document.notFound")
            documents_on_map.append(item.document_id)
        if item.master_only and not is_master:
            raise MasterOnlyNotAllowedError("errors.map.masterOnly")
    if len(documents_on_map) != len(set(documents_on_map)):
        raise InvalidBoardError("errors.map.invalidBoard")

    area_ids = {area.id for area in areas}
    pin_ids = {pin.id for pin in pins}
    for link in links:
        for end in (link.from_end, link.to_end):
            if (end.area_id is None) == (end.pin_id is None):
                raise InvalidBoardError("errors.map.invalidBoard")
            if end.area_id is not None and end.area_id not in area_ids:
                raise InvalidBoardError("errors.map.invalidBoard")
            if end.pin_id is not None and end.pin_id not in pin_ids:
                raise InvalidBoardError("errors.map.invalidBoard")
        if link.from_end.id == link.to_end.id:
            raise InvalidBoardError("errors.map.invalidBoard")
        if link.master_only and not is_master:
            raise MasterOnlyNotAllowedError("errors.map.masterOnly")

    # A hidden link whose shown end the editor deletes goes with it (the
    # database cascades); it no longer counts.
    kept_ids = area_ids | pin_ids | {area.id for area in hidden_areas}
    kept_ids |= {pin.id for pin in hidden_pins}
    surviving_hidden_links = [
        link for link in hidden_links if link.from_end.id in kept_ids and link.to_end.id in kept_ids
    ]
    if len(areas) + len(hidden_areas) > MAX_AREAS_PER_MAP:
        raise MapLimitError("errors.map.tooManyAreas", max=MAX_AREAS_PER_MAP)
    if len(pins) + len(hidden_pins) > MAX_PINS_PER_MAP:
        raise MapLimitError("errors.map.tooManyPins", max=MAX_PINS_PER_MAP)
    if len(links) + len(surviving_hidden_links) > MAX_LINKS_PER_MAP:
        raise MapLimitError("errors.map.tooManyLinks", max=MAX_LINKS_PER_MAP)

    return GeoBoardPlan(
        areas=areas,
        pins=pins,
        links=links,
        delete_area_ids=frozenset(shown_areas.keys() - area_ids),
        delete_pin_ids=frozenset(shown_pins.keys() - pin_ids),
        delete_link_ids=frozenset(shown_links.keys() - {link.id for link in links}),
    )


def geo_document_counts(
    boards: Mapping[uuid.UUID, GeoBoard], visible_document_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """`geo_document_count` for each map of a list."""
    return {
        map_id: geo_document_count(board, visible_document_ids) for map_id, board in boards.items()
    }

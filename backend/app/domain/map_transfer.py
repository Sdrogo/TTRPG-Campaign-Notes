"""Maps in the Room export and the import (spec 40): a map as the JSON export
writes it (`map_to_json`), read back from a file (`read_map`) and planned
into a new map of the target Room (`plan_map`).

Pure: no database, no network. What a file says about a map is checked the
way a board save checks what an editor sends (`plan_board_edit`,
`plan_geo_board_edit`): a map that doesn't pass is skipped, never written in
part. Its ids only link objects inside the file."""

import math
import uuid
from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum
from typing import Any

from app.domain.errors import DomainError
from app.domain.geographic_maps import (
    Area,
    GeoBoard,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
    clean_plane,
    plan_geo_board_edit,
)
from app.domain.models import DocumentVisibility, RoomRole
from app.domain.relationship_maps import (
    MAX_MAPS_PER_ROOM,
    ArrowDirection,
    ArrowEnd,
    Board,
    CardSize,
    MapArrow,
    MapCard,
    MapColor,
    MapGroup,
    MapKind,
    RelationshipMap,
    clean_map_fields,
    plan_board_edit,
)
from app.domain.room_copy import SourceMap

MAX_MAPS_PER_IMPORT = MAX_MAPS_PER_ROOM


class UnreadableMapError(DomainError):
    """A map of the file whose fields aren't what the export writes: it is
    skipped as `invalid` (spec 40 Decision 12)."""


class MapSkipReason(StrEnum):
    """Why a map of the file is not created: it breaks a rule of the board
    save (`invalid`), or the Room has no room for it (`limit`)."""

    INVALID = "invalid"
    LIMIT = "limit"


# --- Export --------------------------------------------------------------------


def _ids(values: Collection[uuid.UUID]) -> list[str]:
    """Ids as strings, in order."""
    return [str(value) for value in values]


def _opt(value: uuid.UUID | None) -> str | None:
    """An optional id as a string."""
    return None if value is None else str(value)


def map_to_json(
    relationship_map: RelationshipMap,
    board: Board,
    geo: GeoBoard,
    background_url: str | None,
    linked_document_ids: Collection[uuid.UUID],
) -> dict[str, Any]:
    """A map of the JSON export (spec 40 Decision 8): its fields, the
    Documents of the file that show it on their page, and its content as the
    requester sees it, already filtered by the caller. A free map has
    `groups`, `cards` and `arrows`, a geographic one `areas`, `pins` and
    `links`; both lists are always present."""
    return {
        "id": str(relationship_map.id),
        "name": relationship_map.name,
        "description": relationship_map.description,
        "kind": relationship_map.kind.value,
        "visibility": relationship_map.visibility.value,
        "plane_width": relationship_map.plane_width,
        "plane_height": relationship_map.plane_height,
        "background_url": background_url,
        "linked_document_ids": _ids(linked_document_ids),
        "groups": [
            {
                "id": str(g.id),
                "title": g.title,
                "color": g.color.value,
                "struck": g.struck,
                "x": g.x,
                "y": g.y,
                "width": g.width,
                "height": g.height,
            }
            for g in board.groups
        ],
        "cards": [
            {
                "id": str(c.id),
                "document_id": _opt(c.document_id),
                "text": c.text,
                "group_id": _opt(c.group_id),
                "caption": c.caption,
                "image_id": _opt(c.image_id),
                "size": c.size.value,
                "master_only": c.master_only,
                "color": c.color.value,
                "struck": c.struck,
                "x": c.x,
                "y": c.y,
            }
            for c in board.cards
        ],
        "arrows": [
            {
                "id": str(a.id),
                "from_end": {
                    "card_id": _opt(a.from_end.card_id),
                    "group_id": _opt(a.from_end.group_id),
                },
                "to_end": {"card_id": _opt(a.to_end.card_id), "group_id": _opt(a.to_end.group_id)},
                "direction": a.direction.value,
                "label": a.label,
                "reverse_label": a.reverse_label,
                "label_position": a.label_position,
                "reverse_label_position": a.reverse_label_position,
                "label_offset": a.label_offset,
                "reverse_label_offset": a.reverse_label_offset,
                "color": a.color.value,
                "master_only": a.master_only,
            }
            for a in board.arrows
        ],
        "areas": [
            {
                "id": str(a.id),
                "document_id": _opt(a.document_id),
                "name": a.name,
                "subtitle": a.subtitle,
                "note": a.note,
                "points": [[x, y] for x, y in a.points],
                "color": a.color.value,
                "dashed": a.dashed,
                "filled": a.filled,
                "master_only": a.master_only,
            }
            for a in geo.areas
        ],
        "pins": [
            {
                "id": str(p.id),
                "document_id": _opt(p.document_id),
                "name": p.name,
                "note": p.note,
                "x": p.x,
                "y": p.y,
                "label_side": p.label_side.value,
                "color": p.color.value,
                "master_only": p.master_only,
            }
            for p in geo.pins
        ],
        "links": [
            {
                "id": str(link.id),
                "from_end": {
                    "area_id": _opt(link.from_end.area_id),
                    "pin_id": _opt(link.from_end.pin_id),
                },
                "to_end": {
                    "area_id": _opt(link.to_end.area_id),
                    "pin_id": _opt(link.to_end.pin_id),
                },
                "direction": link.direction.value,
                "label": link.label,
                "reverse_label": link.reverse_label,
                "bend": link.bend,
                "label_position": link.label_position,
                "reverse_label_position": link.reverse_label_position,
                "label_offset": link.label_offset,
                "reverse_label_offset": link.reverse_label_offset,
                "color": link.color.value,
                "master_only": link.master_only,
            }
            for link in geo.links
        ],
    }


# --- Reading a map of a file ---------------------------------------------------


@dataclass(frozen=True)
class FileMap:
    """A map as the file holds it, its ids still the file's: a card, area or
    pin names a Document of the file, a card's `image_id` one of that
    Document's images in the file."""

    name: str
    description: str
    kind: MapKind
    visibility: str | None
    plane_width: int | None
    plane_height: int | None
    background_url: str | None
    linked_document_ids: tuple[uuid.UUID, ...]
    board: Board
    geo: GeoBoard


def _unreadable() -> UnreadableMapError:
    return UnreadableMapError("errors.map.invalidBoard")


def _object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _unreadable()
    return value


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise _unreadable()
    return value


def _uuid(value: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise _unreadable() from exc


def _opt_uuid(value: Any) -> uuid.UUID | None:
    return None if value is None else _uuid(value)


def _number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise _unreadable()
    return float(value)


def _opt_number(value: Any) -> float | None:
    return None if value is None else _number(value)


def _opt_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise _unreadable()
    return value


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise _unreadable()
    return value


def _flag(value: Any) -> bool:
    return value is True


def _choice[E: StrEnum](kind: type[E], value: Any, default: E) -> E:
    """One of `kind`'s values; absent is `default`, anything else unreadable."""
    if value is None:
        return default
    try:
        return kind(value)
    except ValueError as exc:
        raise _unreadable() from exc


def _arrow_end(raw: Any) -> ArrowEnd:
    end = _object(raw)
    card_id, group_id = _opt_uuid(end.get("card_id")), _opt_uuid(end.get("group_id"))
    if (card_id is None) == (group_id is None):
        raise _unreadable()
    return ArrowEnd(card_id=card_id, group_id=group_id)


def _link_end(raw: Any) -> LinkEnd:
    end = _object(raw)
    area_id, pin_id = _opt_uuid(end.get("area_id")), _opt_uuid(end.get("pin_id"))
    if (area_id is None) == (pin_id is None):
        raise _unreadable()
    return LinkEnd(area_id=area_id, pin_id=pin_id)


def _point(raw: Any) -> tuple[float, float]:
    point = _list(raw)
    if len(point) != 2:
        raise _unreadable()
    return _number(point[0]), _number(point[1])


def read_map(raw: Any) -> FileMap:
    """A map object of the file (spec 40 Decision 8) as `FileMap`.
    `UnreadableMapError` when a field has the wrong type or value; extra
    fields are ignored and a missing color, size, side or direction takes its
    default. Mention maps are never in a file: a `kind` other than `free` or
    `geographic` is unreadable."""
    data = _object(raw)
    groups = [
        MapGroup(
            id=_uuid(g.get("id")),
            title=_opt_str(g.get("title")),
            color=_choice(MapColor, g.get("color"), MapColor.DEFAULT),
            struck=_flag(g.get("struck")),
            x=_number(g.get("x")),
            y=_number(g.get("y")),
            width=_number(g.get("width")),
            height=_number(g.get("height")),
        )
        for g in map(_object, _list(data.get("groups")))
    ]
    cards = [
        MapCard(
            id=_uuid(c.get("id")),
            document_id=_opt_uuid(c.get("document_id")),
            text=_opt_str(c.get("text")),
            group_id=_opt_uuid(c.get("group_id")),
            caption=_opt_str(c.get("caption")),
            image_id=_opt_uuid(c.get("image_id")),
            size=_choice(CardSize, c.get("size"), CardSize.NORMAL),
            master_only=_flag(c.get("master_only")),
            color=_choice(MapColor, c.get("color"), MapColor.DEFAULT),
            struck=_flag(c.get("struck")),
            x=_number(c.get("x")),
            y=_number(c.get("y")),
        )
        for c in map(_object, _list(data.get("cards")))
    ]
    arrows = [
        MapArrow(
            id=_uuid(a.get("id")),
            from_end=_arrow_end(a.get("from_end")),
            to_end=_arrow_end(a.get("to_end")),
            direction=_choice(ArrowDirection, a.get("direction"), ArrowDirection.FORWARD),
            label=_opt_str(a.get("label")),
            reverse_label=_opt_str(a.get("reverse_label")),
            label_position=_opt_number(a.get("label_position")),
            reverse_label_position=_opt_number(a.get("reverse_label_position")),
            label_offset=_opt_number(a.get("label_offset")),
            reverse_label_offset=_opt_number(a.get("reverse_label_offset")),
            color=_choice(MapColor, a.get("color"), MapColor.DEFAULT),
            master_only=_flag(a.get("master_only")),
        )
        for a in map(_object, _list(data.get("arrows")))
    ]
    areas = [
        Area(
            id=_uuid(a.get("id")),
            document_id=_opt_uuid(a.get("document_id")),
            name=_opt_str(a.get("name")),
            subtitle=_opt_str(a.get("subtitle")),
            note=_opt_str(a.get("note")),
            points=tuple(_point(point) for point in _list(a.get("points"))),
            color=_choice(MapColor, a.get("color"), MapColor.DEFAULT),
            dashed=_flag(a.get("dashed")),
            filled=a.get("filled") is not False,
            master_only=_flag(a.get("master_only")),
        )
        for a in map(_object, _list(data.get("areas")))
    ]
    pins = [
        Pin(
            id=_uuid(p.get("id")),
            document_id=_opt_uuid(p.get("document_id")),
            name=_opt_str(p.get("name")),
            note=_opt_str(p.get("note")),
            x=_number(p.get("x")),
            y=_number(p.get("y")),
            label_side=_choice(LabelSide, p.get("label_side"), LabelSide.RIGHT),
            color=_choice(MapColor, p.get("color"), MapColor.DEFAULT),
            master_only=_flag(p.get("master_only")),
        )
        for p in map(_object, _list(data.get("pins")))
    ]
    links = [
        Link(
            id=_uuid(link.get("id")),
            from_end=_link_end(link.get("from_end")),
            to_end=_link_end(link.get("to_end")),
            direction=_choice(ArrowDirection, link.get("direction"), ArrowDirection.FORWARD),
            label=_opt_str(link.get("label")),
            reverse_label=_opt_str(link.get("reverse_label")),
            bend=_opt_number(link.get("bend")),
            label_position=_opt_number(link.get("label_position")),
            reverse_label_position=_opt_number(link.get("reverse_label_position")),
            label_offset=_opt_number(link.get("label_offset")),
            reverse_label_offset=_opt_number(link.get("reverse_label_offset")),
            color=_choice(MapColor, link.get("color"), MapColor.DEFAULT),
            master_only=_flag(link.get("master_only")),
        )
        for link in map(_object, _list(data.get("links")))
    ]
    return FileMap(
        name=_opt_str(data.get("name")) or "",
        description=_opt_str(data.get("description")) or "",
        kind=_choice(MapKind, data.get("kind"), MapKind.FREE),
        visibility=_opt_str(data.get("visibility")),
        plane_width=_opt_int(data.get("plane_width")),
        plane_height=_opt_int(data.get("plane_height")),
        background_url=_opt_str(data.get("background_url")),
        linked_document_ids=tuple(_uuid(i) for i in _list(data.get("linked_document_ids"))),
        board=Board(groups=groups, cards=cards, arrows=arrows),
        geo=GeoBoard(areas=areas, pins=pins, links=links),
    )


def map_name(raw: Any) -> str:
    """The name a map of the file shows in the preview, even when it can't be
    read."""
    name = raw.get("name") if isinstance(raw, dict) else None
    return name.strip() if isinstance(name, str) else ""


# --- Planning a map of the file --------------------------------------------------


@dataclass(frozen=True)
class CardImage:
    """A card's chosen image, by its id in the file: the job points the card
    at it once the image is attached (spec 40 Decision 13)."""

    card_id: uuid.UUID
    document_id: uuid.UUID
    source_id: str


@dataclass(frozen=True)
class PlannedMap:
    """A map of the file and what becomes of it: a new map under `id` with
    its cleaned content, or `skipped` and why. `left_out` counts the cards,
    areas and pins whose Document isn't imported, `master_only_dropped` the
    Master-only items a non-Master can't import (spec 40 Decisions 10, 11)."""

    key: str
    file_name: str
    id: uuid.UUID
    name: str
    description: str
    kind: MapKind
    visibility: DocumentVisibility
    selective_to_private: bool
    plane_width: int | None
    plane_height: int | None
    background_url: str | None
    board: Board
    geo: GeoBoard
    linked_document_ids: tuple[uuid.UUID, ...]
    card_images: tuple[CardImage, ...]
    left_out: int
    master_only_dropped: int
    skipped: MapSkipReason | None = None

    @property
    def document_count(self) -> int:
        """How many Documents the new map places."""
        cards = [card.document_id for card in self.board.cards]
        places = [area.document_id for area in self.geo.areas]
        places += [pin.document_id for pin in self.geo.pins]
        return sum(1 for document_id in (*cards, *places) if document_id is not None)


def map_key(file_index: int, map_index: int) -> str:
    """The key a client uses for a map of an upload, like `document_key`."""
    return f"{file_index}:map:{map_index}"


def skipped_map(key: str, file_name: str, name: str, reason: MapSkipReason) -> PlannedMap:
    """A map of the file that is not created."""
    return PlannedMap(
        key=key,
        file_name=file_name,
        id=uuid.uuid4(),
        name=name,
        description="",
        kind=MapKind.FREE,
        visibility=DocumentVisibility.ROOM,
        selective_to_private=False,
        plane_width=None,
        plane_height=None,
        background_url=None,
        board=Board(),
        geo=GeoBoard(),
        linked_document_ids=(),
        card_images=(),
        left_out=0,
        master_only_dropped=0,
        skipped=reason,
    )


def plan_map(
    file_map: FileMap,
    key: str,
    file_name: str,
    visibility: tuple[DocumentVisibility, bool],
    documents: Mapping[uuid.UUID, uuid.UUID],
    copied: Collection[uuid.UUID],
    is_master: bool,
    new_id: Callable[[], uuid.UUID] = uuid.uuid4,
) -> PlannedMap:
    """The new map for `file_map` (spec 40 Decisions 9 to 12, 14).
    `documents` maps a Document id of the file to the Document it becomes
    (copied or replaced), `copied` are the new ones (only those take the map's
    link to their page), `visibility` the level and whether it was Selective.
    What points at a Document not imported is left out, Master-only items
    too unless `is_master`, with the arrows and links touching them; the rest
    goes through the board save's checks against an empty map. A map that
    fails them is `skipped` as `invalid`."""
    master_only_dropped = 0
    left_out = 0

    group_ids = {group.id: new_id() for group in file_map.board.groups}
    card_ids: dict[uuid.UUID, uuid.UUID] = {}
    cards: list[MapCard] = []
    card_images: list[CardImage] = []
    for card in file_map.board.cards:
        document_id = None
        if card.document_id is not None:
            document_id = documents.get(card.document_id)
            if document_id is None:
                left_out += 1
                continue
        elif card.master_only and not is_master:
            master_only_dropped += 1
            continue
        card_ids[card.id] = new_id()
        if document_id is not None and card.image_id is not None:
            card_images.append(CardImage(card_ids[card.id], document_id, str(card.image_id)))
        cards.append(
            replace(
                card,
                id=card_ids[card.id],
                document_id=document_id,
                group_id=None if card.group_id is None else group_ids.get(card.group_id),
                image_id=None,
            )
        )

    arrows: list[MapArrow] = []
    for arrow in file_map.board.arrows:
        if arrow.master_only and not is_master:
            master_only_dropped += 1
            continue
        ends = [
            ArrowEnd(card_id=card_ids[end.id])
            if end.card_id is not None and end.card_id in card_ids
            else ArrowEnd(group_id=group_ids[end.id])
            if end.group_id is not None and end.group_id in group_ids
            else None
            for end in (arrow.from_end, arrow.to_end)
        ]
        if ends[0] is not None and ends[1] is not None:
            arrows.append(replace(arrow, id=new_id(), from_end=ends[0], to_end=ends[1]))

    place_ids: dict[uuid.UUID, uuid.UUID] = {}

    def keep_place(
        document_id: uuid.UUID | None, master_only: bool
    ) -> tuple[bool, uuid.UUID | None]:
        """Whether an area or pin is kept, and the Document it points at now
        (None for a plain one)."""
        nonlocal left_out, master_only_dropped
        if document_id is not None:
            found = documents.get(document_id)
            left_out += found is None
            return found is not None, found
        if master_only and not is_master:
            master_only_dropped += 1
            return False, None
        return True, None

    areas: list[Area] = []
    for area in file_map.geo.areas:
        kept, area_document = keep_place(area.document_id, area.master_only)
        if kept:
            place_ids[area.id] = new_id()
            areas.append(replace(area, id=place_ids[area.id], document_id=area_document))
    pins: list[Pin] = []
    for pin in file_map.geo.pins:
        kept, pin_document = keep_place(pin.document_id, pin.master_only)
        if kept:
            place_ids[pin.id] = new_id()
            pins.append(replace(pin, id=place_ids[pin.id], document_id=pin_document))

    links: list[Link] = []
    for link in file_map.geo.links:
        if link.master_only and not is_master:
            master_only_dropped += 1
            continue
        link_ends = [
            None
            if end.id not in place_ids
            else LinkEnd(area_id=place_ids[end.id])
            if end.area_id is not None
            else LinkEnd(pin_id=place_ids[end.id])
            for end in (link.from_end, link.to_end)
        ]
        if link_ends[0] is not None and link_ends[1] is not None:
            links.append(replace(link, id=new_id(), from_end=link_ends[0], to_end=link_ends[1]))

    level, selective = visibility
    planned = PlannedMap(
        key=key,
        file_name=file_name,
        id=new_id(),
        name=file_map.name.strip(),
        description=file_map.description,
        kind=file_map.kind,
        visibility=level,
        selective_to_private=selective,
        plane_width=None,
        plane_height=None,
        background_url=None,
        board=Board(),
        geo=GeoBoard(),
        linked_document_ids=tuple(
            dict.fromkeys(
                documents[document_id]
                for document_id in file_map.linked_document_ids
                if document_id in documents and documents[document_id] in copied
            )
        ),
        card_images=tuple(card_images),
        left_out=left_out,
        master_only_dropped=master_only_dropped,
    )
    placed = {*documents.values()}
    try:
        name, description = clean_map_fields(file_map.name, file_map.description)
        if file_map.kind is MapKind.GEOGRAPHIC:
            plane_width, plane_height = clean_plane(file_map.plane_width, file_map.plane_height)
            geo_plan = plan_geo_board_edit(
                GeoBoard(),
                GeoBoard(),
                GeoBoard(areas=areas, pins=pins, links=links),
                RoomRole.MASTER,
                placed,
                plane_width,
                plane_height,
            )
            return replace(
                planned,
                name=name,
                description=description,
                plane_width=plane_width,
                plane_height=plane_height,
                background_url=file_map.background_url,
                geo=GeoBoard(areas=geo_plan.areas, pins=geo_plan.pins, links=geo_plan.links),
                card_images=(),
            )
        groups = [replace(group, id=group_ids[group.id]) for group in file_map.board.groups]
        board_plan = plan_board_edit(
            Board(),
            Board(),
            Board(groups=groups, cards=cards, arrows=arrows),
            RoomRole.MASTER,
            placed,
        )
    except DomainError:
        return replace(planned, skipped=MapSkipReason.INVALID, card_images=())
    return replace(
        planned,
        name=name,
        description=description,
        board=Board(groups=board_plan.groups, cards=board_plan.cards, arrows=board_plan.arrows),
    )


def to_source_map(
    planned: PlannedMap, room_id: uuid.UUID, creator: uuid.UUID, now: datetime
) -> SourceMap:
    """A planned map as the whole map `map_transfer_repo.insert_maps` writes,
    with no background yet (the job attaches it after the commit)."""
    return SourceMap(
        map=RelationshipMap(
            id=planned.id,
            room_id=room_id,
            name=planned.name,
            description=planned.description,
            visibility=planned.visibility,
            created_by=creator,
            created_at=now,
            updated_at=now,
            kind=planned.kind,
            plane_width=planned.plane_width,
            plane_height=planned.plane_height,
        ),
        board=planned.board,
        geo=planned.geo,
        linked_document_ids=planned.linked_document_ids,
    )

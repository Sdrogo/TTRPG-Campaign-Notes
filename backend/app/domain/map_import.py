"""A geographic map as a JSON file (spec 38_3, Decision 10): reading an
imported file into a new map's content, and writing a map back to the same
format.

The file names Documents by name, matched exactly but ignoring case among
the Documents the importer sees. A name that matches none of them (or only
a hidden one, which they don't see) becomes a plain area or pin with that
name, and the report says "not found" the same way, so it never reveals a
hidden Document. The export is built from the map as the viewer sees it
(`visible_geo_board`), so it holds nothing hidden from them either."""

import math
import re
import unicodedata
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from app.domain.errors import DomainError
from app.domain.geographic_maps import (
    MAX_AREA_POINTS,
    MAX_AREAS_PER_MAP,
    MAX_LINKS_PER_MAP,
    MAX_PINS_PER_MAP,
    MAX_PLACE_NAME_LENGTH,
    MIN_AREA_POINTS,
    MIN_AREA_SURFACE,
    Area,
    GeoBoard,
    GeoBoardPlan,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
    clean_plane,
    plan_geo_board_edit,
    polygon_surface,
)
from app.domain.models import Document, RoomRole
from app.domain.relationship_maps import ArrowDirection, MapColor, MapLimitError

SCHEMA_VERSION = 1
FILE_KIND = "geographic_map"
# The longest key the export makes from a name.
MAX_KEY_LENGTH = 40


class MapImportError(DomainError):
    """The file can't become a map: a repeated key, a link to a key that
    isn't there, an area or pin that doesn't fit the plane... `item` names the
    item at fault. Answered with 422."""


@dataclass(frozen=True)
class ImportedArea:
    """An area as the file gives it: `document` is a Document's name, or None
    for a plain area described by `name`, `subtitle` and `note`."""

    key: str
    points: tuple[tuple[float, float], ...]
    document: str | None = None
    name: str | None = None
    subtitle: str | None = None
    note: str | None = None
    color: MapColor = MapColor.DEFAULT
    filled: bool = True
    dashed: bool = False
    master_only: bool = False


@dataclass(frozen=True)
class ImportedPin:
    """A pin as the file gives it, `document` as for an area."""

    key: str
    x: float
    y: float
    document: str | None = None
    name: str | None = None
    note: str | None = None
    label_side: LabelSide = LabelSide.RIGHT
    color: MapColor = MapColor.DEFAULT
    master_only: bool = False


@dataclass(frozen=True)
class ImportedLink:
    """A link as the file gives it, between the keys of two areas or pins."""

    from_key: str
    to_key: str
    direction: ArrowDirection = ArrowDirection.FORWARD
    label: str | None = None
    reverse_label: str | None = None
    color: MapColor = MapColor.DEFAULT
    bend: float | None = None
    master_only: bool = False


@dataclass(frozen=True)
class MapFile:
    """What an import file holds, already read into types (the API checks
    its shape); the checks against the plane and the Room are
    `plan_map_import`'s."""

    name: str
    plane_width: int
    plane_height: int
    description: str = ""
    areas: Sequence[ImportedArea] = ()
    pins: Sequence[ImportedPin] = ()
    links: Sequence[ImportedLink] = ()


@dataclass(frozen=True)
class ImportReport:
    """What an import will create, shown before the user confirms it: how
    many areas, pins and links, how many are bound to a Document, and the
    names kept as plain labels because they matched no Document the importer
    sees (`not_found`), matched several (`ambiguous`), or named a Document
    already on the map (`repeated`). Every name comes from the file."""

    areas: int
    pins: int
    links: int
    matched: int
    not_found: Sequence[str] = ()
    ambiguous: Sequence[str] = ()
    repeated: Sequence[str] = ()


@dataclass(frozen=True)
class MapImport:
    """An import ready to be written: the new map's plane and content (with
    fresh ids, checked as a save of the importer's would be) and its
    report."""

    plane_width: int
    plane_height: int
    plan: GeoBoardPlan
    report: ImportReport


@dataclass
class _Matches:
    """The Documents resolved so far, and the names that fell back to plain
    labels, each listed once in the order the file gives them."""

    used: set[uuid.UUID] = field(default_factory=set)
    not_found: list[str] = field(default_factory=list)
    ambiguous: list[str] = field(default_factory=list)
    repeated: list[str] = field(default_factory=list)


def _name_key(name: str) -> str:
    """A name as it is matched: trimmed, ignoring case."""
    return name.strip().casefold()


def document_index(documents: Iterable[Document]) -> dict[str, list[uuid.UUID]]:
    """The importer's Documents by matched name; a name may stand for several
    Documents."""
    index: dict[str, list[uuid.UUID]] = {}
    for document in documents:
        index.setdefault(_name_key(document.name), []).append(document.id)
    return index


def _resolve(
    name: str | None, index: Mapping[str, Sequence[uuid.UUID]], matches: _Matches
) -> tuple[uuid.UUID | None, str | None]:
    """The Document `name` stands for, or None with the name a plain label
    keeps instead (None when the item names no Document)."""
    if name is None or not name.strip():
        return None, None
    found = index.get(_name_key(name), ())
    if len(found) == 1 and found[0] not in matches.used:
        matches.used.add(found[0])
        return found[0], None
    label = name.strip()
    bucket = (
        matches.not_found
        if not found
        else matches.ambiguous
        if len(found) > 1
        else matches.repeated
    )
    if label not in bucket:
        bucket.append(label)
    return None, label[:MAX_PLACE_NAME_LENGTH]


def _in_plane(x: float, y: float, plane_width: int, plane_height: int) -> bool:
    """Whether the point is a finite number inside the plane."""
    return (
        math.isfinite(x) and math.isfinite(y) and 0 <= x <= plane_width and 0 <= y <= plane_height
    )


def _check_texts(key: str, document_id: uuid.UUID | None, name: str | None) -> None:
    """A plain area or pin needs a name."""
    if document_id is None and not (name and name.strip()):
        raise MapImportError("errors.mapImport.nameRequired", item=key)


def _check_area(area: ImportedArea, plane_width: int, plane_height: int) -> None:
    """3 to 60 corners inside the plane, around a real surface."""
    if (
        not MIN_AREA_POINTS <= len(area.points) <= MAX_AREA_POINTS
        or not all(_in_plane(x, y, plane_width, plane_height) for x, y in area.points)
        or polygon_surface(area.points) < MIN_AREA_SURFACE
    ):
        raise MapImportError("errors.mapImport.invalidArea", item=area.key)


def plan_map_import(
    map_file: MapFile, documents: Iterable[Document], importer_role: RoomRole
) -> MapImport:
    """Turns a file into a new map's content (Decision 10). `documents` are
    the Room's Documents the importer sees. Refused: a plane out of range
    (`InvalidPlaneError`), more than the caps (`MapLimitError`), a key used
    twice, a link to a key that isn't in the file or from a key to itself, an
    area or pin that doesn't fit the plane, a plain one with no name
    (`MapImportError`); then whatever a save of the importer's would refuse
    (`plan_geo_board_edit`: a text too long, Master-only content from a
    Player)."""
    plane_width, plane_height = clean_plane(map_file.plane_width, map_file.plane_height)
    if len(map_file.areas) > MAX_AREAS_PER_MAP:
        raise MapLimitError("errors.map.tooManyAreas", max=MAX_AREAS_PER_MAP)
    if len(map_file.pins) > MAX_PINS_PER_MAP:
        raise MapLimitError("errors.map.tooManyPins", max=MAX_PINS_PER_MAP)
    if len(map_file.links) > MAX_LINKS_PER_MAP:
        raise MapLimitError("errors.map.tooManyLinks", max=MAX_LINKS_PER_MAP)

    ends: dict[str, LinkEnd] = {}
    # The map is read back in id order: fresh ids handed out in increasing
    # order keep the file's order (areas drawn later lie on top).
    fresh_ids = iter(
        sorted(
            uuid.uuid4()
            for _ in range(len(map_file.areas) + len(map_file.pins) + len(map_file.links))
        )
    )

    def claim(key: str) -> uuid.UUID:
        """A fresh id for the item `key`, which must not be taken."""
        if key in ends:
            raise MapImportError("errors.mapImport.duplicateKey", item=key)
        return next(fresh_ids)

    index = document_index(documents)
    matches = _Matches()
    areas: list[Area] = []
    for imported_area in map_file.areas:
        area_id = claim(imported_area.key)
        ends[imported_area.key] = LinkEnd(area_id=area_id)
        _check_area(imported_area, plane_width, plane_height)
        document_id, label = _resolve(imported_area.document, index, matches)
        name = label if label is not None else imported_area.name
        _check_texts(imported_area.key, document_id, name)
        areas.append(
            Area(
                id=area_id,
                document_id=document_id,
                name=name,
                subtitle=imported_area.subtitle,
                note=imported_area.note,
                points=imported_area.points,
                color=imported_area.color,
                dashed=imported_area.dashed,
                filled=imported_area.filled,
                master_only=imported_area.master_only,
            )
        )
    pins: list[Pin] = []
    for imported_pin in map_file.pins:
        pin_id = claim(imported_pin.key)
        ends[imported_pin.key] = LinkEnd(pin_id=pin_id)
        if not _in_plane(imported_pin.x, imported_pin.y, plane_width, plane_height):
            raise MapImportError("errors.mapImport.pinOutsidePlane", item=imported_pin.key)
        document_id, label = _resolve(imported_pin.document, index, matches)
        name = label if label is not None else imported_pin.name
        _check_texts(imported_pin.key, document_id, name)
        pins.append(
            Pin(
                id=pin_id,
                document_id=document_id,
                name=name,
                note=imported_pin.note,
                x=imported_pin.x,
                y=imported_pin.y,
                label_side=imported_pin.label_side,
                color=imported_pin.color,
                master_only=imported_pin.master_only,
            )
        )
    links: list[Link] = []
    for imported_link in map_file.links:
        for key in (imported_link.from_key, imported_link.to_key):
            if key not in ends:
                raise MapImportError("errors.mapImport.unknownKey", item=key)
        if imported_link.from_key == imported_link.to_key:
            raise MapImportError("errors.mapImport.linkToItself", item=imported_link.from_key)
        links.append(
            Link(
                id=next(fresh_ids),
                from_end=ends[imported_link.from_key],
                to_end=ends[imported_link.to_key],
                direction=imported_link.direction,
                label=imported_link.label,
                reverse_label=imported_link.reverse_label,
                color=imported_link.color,
                master_only=imported_link.master_only,
                bend=imported_link.bend,
            )
        )

    plan = plan_geo_board_edit(
        GeoBoard(),
        GeoBoard(),
        GeoBoard(areas=areas, pins=pins, links=links),
        importer_role,
        matches.used,
        plane_width,
        plane_height,
    )
    return MapImport(
        plane_width=plane_width,
        plane_height=plane_height,
        plan=plan,
        report=ImportReport(
            areas=len(areas),
            pins=len(pins),
            links=len(links),
            matched=len(matches.used),
            not_found=tuple(matches.not_found),
            ambiguous=tuple(matches.ambiguous),
            repeated=tuple(matches.repeated),
        ),
    )


# --- Export -------------------------------------------------------------------


def _slug(text: str) -> str:
    """Lowercase ASCII letters and digits joined by hyphens."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")[:MAX_KEY_LENGTH].strip("-")


def _unique_key(text: str, fallback: str, taken: set[str]) -> str:
    """A key made from `text` (`fallback` when nothing is left of it), with a
    number added until no other item has it."""
    base = _slug(text) or fallback
    key, number = base, 2
    while key in taken:
        key, number = f"{base}-{number}", number + 1
    taken.add(key)
    return key


def _number(value: float) -> float | int:
    """A coordinate as written in the file: whole numbers without `.0`."""
    return int(value) if float(value).is_integer() else value


def _place(
    document_id: uuid.UUID | None,
    name: str | None,
    note: str | None,
    master_only: bool,
    document_names: Mapping[uuid.UUID, str],
) -> dict[str, Any]:
    """The fields that say what an area or pin stands for: its Document's
    name, or its own name and note."""
    if document_id is not None:
        return {"document": document_names[document_id]}
    place: dict[str, Any] = {"name": name}
    if note:
        place["note"] = note
    if master_only:
        place["master_only"] = True
    return place


def export_map_file(
    name: str,
    description: str,
    plane_width: int,
    plane_height: int,
    shown: GeoBoard,
    document_names: Mapping[uuid.UUID, str],
) -> dict[str, Any]:
    """The map as an import file (Decision 10), from `shown`, the map as the
    viewer sees it (`visible_geo_board`); `document_names` holds the names of
    the Documents on it. Keys are made from the names, so importing the file
    again gives back the same map."""
    taken: set[str] = set()
    keys: dict[uuid.UUID, str] = {}

    def key_for(item_id: uuid.UUID, label: str, fallback: str) -> str:
        """The item's key, made once."""
        keys[item_id] = _unique_key(label, fallback, taken)
        return keys[item_id]

    def label_of(document_id: uuid.UUID | None, own_name: str | None) -> str:
        """The name a key is made from."""
        return document_names[document_id] if document_id is not None else own_name or ""

    areas: list[dict[str, Any]] = []
    for area in shown.areas:
        entry: dict[str, Any] = {
            "key": key_for(area.id, label_of(area.document_id, area.name), "area")
        }
        entry.update(
            _place(area.document_id, area.name, area.note, area.master_only, document_names)
        )
        if area.document_id is None and area.subtitle:
            entry["subtitle"] = area.subtitle
        entry.update(
            points=[[_number(x), _number(y)] for x, y in area.points],
            color=area.color.value,
            filled=area.filled,
            dashed=area.dashed,
        )
        areas.append(entry)
    pins: list[dict[str, Any]] = []
    for pin in shown.pins:
        entry = {"key": key_for(pin.id, label_of(pin.document_id, pin.name), "pin")}
        entry.update(_place(pin.document_id, pin.name, pin.note, pin.master_only, document_names))
        entry.update(
            x=_number(pin.x),
            y=_number(pin.y),
            label_side=pin.label_side.value,
            color=pin.color.value,
        )
        pins.append(entry)
    links: list[dict[str, Any]] = []
    for link in shown.links:
        entry = {
            "from": keys[link.from_end.id],
            "to": keys[link.to_end.id],
            "direction": link.direction.value,
            "color": link.color.value,
        }
        if link.label:
            entry["label"] = link.label
        if link.reverse_label:
            entry["reverse_label"] = link.reverse_label
        if link.bend is not None:
            entry["bend"] = _number(link.bend)
        if link.master_only:
            entry["master_only"] = True
        links.append(entry)
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": FILE_KIND,
        "name": name,
        "description": description,
        "plane": {"width": plane_width, "height": plane_height},
        "areas": areas,
        "pins": pins,
        "links": links,
    }

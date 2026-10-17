"""Geographic maps (spec 38_1): the areas, pins and links of a map. The map
rows themselves, their grants and the background path are in
`app.db.relationship_maps_repo`. Nothing here filters for a viewer: the
routes do, through `app.domain.geographic_maps`."""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RelationshipMapAreaRow, RelationshipMapLinkRow, RelationshipMapPinRow
from app.domain.geographic_maps import (
    Area,
    GeoBoard,
    GeoBoardPlan,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
)
from app.domain.relationship_maps import ArrowDirection, MapColor

_AREA_COLUMNS = (
    "document_id",
    "name",
    "subtitle",
    "note",
    "points",
    "color",
    "dashed",
    "filled",
    "master_only",
)
_PIN_COLUMNS = ("document_id", "name", "note", "x", "y", "label_side", "color", "master_only")
_LINK_COLUMNS = (
    "from_area_id",
    "from_pin_id",
    "to_area_id",
    "to_pin_id",
    "direction",
    "label",
    "reverse_label",
    "bend",
    "label_position",
    "reverse_label_position",
    "label_offset",
    "reverse_label_offset",
    "color",
    "master_only",
)


def _area_from_row(row: RelationshipMapAreaRow) -> Area:
    """Maps an area row to the domain area."""
    return Area(
        id=row.id,
        document_id=row.document_id,
        name=row.name,
        subtitle=row.subtitle,
        note=row.note,
        points=tuple((point[0], point[1]) for point in row.points),
        color=MapColor(row.color),
        dashed=row.dashed,
        filled=row.filled,
        master_only=row.master_only,
    )


def _pin_from_row(row: RelationshipMapPinRow) -> Pin:
    """Maps a pin row to the domain pin."""
    return Pin(
        id=row.id,
        document_id=row.document_id,
        name=row.name,
        note=row.note,
        x=row.x,
        y=row.y,
        label_side=LabelSide(row.label_side),
        color=MapColor(row.color),
        master_only=row.master_only,
    )


def _link_from_row(row: RelationshipMapLinkRow) -> Link:
    """Maps a link row to the domain link."""
    return Link(
        id=row.id,
        from_end=LinkEnd(area_id=row.from_area_id, pin_id=row.from_pin_id),
        to_end=LinkEnd(area_id=row.to_area_id, pin_id=row.to_pin_id),
        direction=ArrowDirection(row.direction),
        label=row.label,
        reverse_label=row.reverse_label,
        color=MapColor(row.color),
        master_only=row.master_only,
        bend=row.bend,
        label_position=row.label_position,
        reverse_label_position=row.reverse_label_position,
        label_offset=row.label_offset,
        reverse_label_offset=row.reverse_label_offset,
    )


async def get_geo_boards(
    session: AsyncSession, map_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, GeoBoard]:
    """Everything on each of these geographic maps, in three queries whatever
    their number, ordered so a map reads the same on every load. A map with
    nothing on it maps to an empty `GeoBoard`. Not yet filtered for any
    viewer."""
    areas: dict[uuid.UUID, list[Area]] = defaultdict(list)
    pins: dict[uuid.UUID, list[Pin]] = defaultdict(list)
    links: dict[uuid.UUID, list[Link]] = defaultdict(list)
    if map_ids:
        area_rows = await session.execute(
            select(RelationshipMapAreaRow)
            .where(RelationshipMapAreaRow.map_id.in_(map_ids))
            .order_by(RelationshipMapAreaRow.id)
        )
        for area_row in area_rows.scalars():
            areas[area_row.map_id].append(_area_from_row(area_row))
        pin_rows = await session.execute(
            select(RelationshipMapPinRow)
            .where(RelationshipMapPinRow.map_id.in_(map_ids))
            .order_by(RelationshipMapPinRow.id)
        )
        for pin_row in pin_rows.scalars():
            pins[pin_row.map_id].append(_pin_from_row(pin_row))
        link_rows = await session.execute(
            select(RelationshipMapLinkRow)
            .where(RelationshipMapLinkRow.map_id.in_(map_ids))
            .order_by(RelationshipMapLinkRow.id)
        )
        for link_row in link_rows.scalars():
            links[link_row.map_id].append(_link_from_row(link_row))
    return {
        map_id: GeoBoard(areas=areas[map_id], pins=pins[map_id], links=links[map_id])
        for map_id in map_ids
    }


async def find_foreign_ids(
    session: AsyncSession, map_id: uuid.UUID, ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these ids already name an area, pin or link of another map: a
    save may not take them over (`plan_geo_board_edit`)."""
    if not ids:
        return set()
    found: set[uuid.UUID] = set()
    for model in (RelationshipMapAreaRow, RelationshipMapPinRow, RelationshipMapLinkRow):
        result = await session.execute(
            select(model.id).where(model.id.in_(ids), model.map_id != map_id)
        )
        found.update(result.scalars())
    return found


async def save_geo_board(session: AsyncSession, map_id: uuid.UUID, plan: GeoBoardPlan) -> None:
    """Applies a save (`plan_geo_board_edit`): deletions first, so a Document
    taken off as an area and put back as a pin in one save doesn't collide
    with its old row, then the areas, pins and links the editor sent, created
    or rewritten. A deleted area or pin takes the links touching it with it.
    Callers hold the map's lock (`relationship_maps_repo.lock_map`)."""
    for model, ids in (
        (RelationshipMapLinkRow, plan.delete_link_ids),
        (RelationshipMapAreaRow, plan.delete_area_ids),
        (RelationshipMapPinRow, plan.delete_pin_ids),
    ):
        if ids:
            await session.execute(
                delete(model).where(model.map_id == map_id, model.id.in_(list(ids)))
            )

    await _upsert(
        session,
        RelationshipMapAreaRow,
        [
            {
                "id": area.id,
                "map_id": map_id,
                "document_id": area.document_id,
                "name": area.name,
                "subtitle": area.subtitle,
                "note": area.note,
                "points": [[x, y] for x, y in area.points],
                "color": area.color.value,
                "dashed": area.dashed,
                "filled": area.filled,
                "master_only": area.master_only,
            }
            for area in plan.areas
        ],
        _AREA_COLUMNS,
    )
    await _upsert(
        session,
        RelationshipMapPinRow,
        [
            {
                "id": pin.id,
                "map_id": map_id,
                "document_id": pin.document_id,
                "name": pin.name,
                "note": pin.note,
                "x": pin.x,
                "y": pin.y,
                "label_side": pin.label_side.value,
                "color": pin.color.value,
                "master_only": pin.master_only,
            }
            for pin in plan.pins
        ],
        _PIN_COLUMNS,
    )
    await _upsert(
        session,
        RelationshipMapLinkRow,
        [
            {
                "id": link.id,
                "map_id": map_id,
                "from_area_id": link.from_end.area_id,
                "from_pin_id": link.from_end.pin_id,
                "to_area_id": link.to_end.area_id,
                "to_pin_id": link.to_end.pin_id,
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
            for link in plan.links
        ],
        _LINK_COLUMNS,
    )
    # Core statements bypass the ORM: what this session cached is stale now.
    await session.flush()
    session.expire_all()


async def _upsert(
    session: AsyncSession,
    model: type[RelationshipMapAreaRow]
    | type[RelationshipMapPinRow]
    | type[RelationshipMapLinkRow],
    values: list[dict[str, Any]],
    columns: Sequence[str],
) -> None:
    """Inserts the rows, or rewrites the `columns` of those whose id exists."""
    if not values:
        return
    statement = insert(model).values(values)
    await session.execute(
        statement.on_conflict_do_update(
            index_elements=["id"], set_={column: statement.excluded[column] for column in columns}
        )
    )

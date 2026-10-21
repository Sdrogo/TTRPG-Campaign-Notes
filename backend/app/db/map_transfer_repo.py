"""Maps moved as a whole (spec 40): every map of a Room read with all that is
on it, for a Room's duplication, and whole maps written at once, for the
duplication and the import. Each kind goes in a fixed number of statements
whatever the number of maps (NFR-04); the caller owns the transaction.
Nothing here filters for a viewer."""

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import geographic_maps_repo, relationship_maps_repo
from app.db.models import (
    DocumentLinkedMapRow,
    RelationshipMapAreaRow,
    RelationshipMapArrowRow,
    RelationshipMapCardRow,
    RelationshipMapGroupRow,
    RelationshipMapLinkRow,
    RelationshipMapPinRow,
    RelationshipMapRow,
)
from app.domain.geographic_maps import GeoBoard
from app.domain.relationship_maps import MapKind
from app.domain.room_copy import SourceMap


async def load_room_maps(session: AsyncSession, room_id: uuid.UUID) -> tuple[SourceMap, ...]:
    """Every map of the Room (free, geographic and mention maps) with its
    board or geographic content and the Documents that show it on their page,
    in a fixed number of queries."""
    maps = await relationship_maps_repo.list_every_map_for_room(session, room_id)
    ids = [relationship_map.id for relationship_map in maps]
    boards = await relationship_maps_repo.get_boards(session, ids)
    geo = await geographic_maps_repo.get_geo_boards(
        session, [m.id for m in maps if m.kind is MapKind.GEOGRAPHIC]
    )
    linked = await relationship_maps_repo.list_linked_documents(session, ids)
    return tuple(
        SourceMap(
            map=relationship_map,
            board=boards[relationship_map.id],
            geo=geo.get(relationship_map.id, GeoBoard()),
            linked_document_ids=tuple(linked[relationship_map.id]),
        )
        for relationship_map in maps
    )


async def _insert(session: AsyncSession, model: Any, values: list[dict[str, Any]]) -> None:
    """One bulk insert, skipped when there is nothing to write."""
    if values:
        await session.execute(insert(model), values)


async def insert_maps(
    session: AsyncSession, maps: Sequence[SourceMap], linked_by: uuid.UUID, now: datetime
) -> None:
    """Writes whole new maps: the map rows (no Selective grants), then their
    groups, cards and arrows, their areas, pins and links, and the Documents
    that show them, linked by `linked_by` at `now`. Every id is new and every
    Document, image and group they name exists already."""
    await _insert(
        session,
        RelationshipMapRow,
        [
            {
                "id": m.map.id,
                "room_id": m.map.room_id,
                "name": m.map.name,
                "description": m.map.description,
                "visibility": m.map.visibility.value,
                "created_by": m.map.created_by,
                "created_at": m.map.created_at,
                "updated_at": m.map.updated_at,
                "source_document_id": m.map.source_document_id,
                "mention_depth": m.map.mention_depth,
                "kind": m.map.kind.value,
                "plane_width": m.map.plane_width,
                "plane_height": m.map.plane_height,
                "background_path": m.map.background_path,
            }
            for m in maps
        ],
    )
    await _insert(
        session,
        RelationshipMapGroupRow,
        [
            {
                "id": group.id,
                "map_id": m.map.id,
                "title": group.title,
                "color": group.color.value,
                "struck": group.struck,
                "x": group.x,
                "y": group.y,
                "width": group.width,
                "height": group.height,
            }
            for m in maps
            for group in m.board.groups
        ],
    )
    await _insert(
        session,
        RelationshipMapCardRow,
        [
            {
                "id": card.id,
                "map_id": m.map.id,
                "group_id": card.group_id,
                "document_id": card.document_id,
                "text": card.text,
                "caption": card.caption,
                "image_id": card.image_id,
                "size": card.size.value,
                "master_only": card.master_only,
                "color": card.color.value,
                "struck": card.struck,
                "x": card.x,
                "y": card.y,
            }
            for m in maps
            for card in m.board.cards
        ],
    )
    await _insert(
        session,
        RelationshipMapArrowRow,
        [
            {
                "id": arrow.id,
                "map_id": m.map.id,
                "from_card_id": arrow.from_end.card_id,
                "from_group_id": arrow.from_end.group_id,
                "to_card_id": arrow.to_end.card_id,
                "to_group_id": arrow.to_end.group_id,
                "direction": arrow.direction.value,
                "label": arrow.label,
                "reverse_label": arrow.reverse_label,
                "label_position": arrow.label_position,
                "reverse_label_position": arrow.reverse_label_position,
                "label_offset": arrow.label_offset,
                "reverse_label_offset": arrow.reverse_label_offset,
                "color": arrow.color.value,
                "master_only": arrow.master_only,
            }
            for m in maps
            for arrow in m.board.arrows
        ],
    )
    await _insert(
        session,
        RelationshipMapAreaRow,
        [
            {
                "id": area.id,
                "map_id": m.map.id,
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
            for m in maps
            for area in m.geo.areas
        ],
    )
    await _insert(
        session,
        RelationshipMapPinRow,
        [
            {
                "id": pin.id,
                "map_id": m.map.id,
                "document_id": pin.document_id,
                "name": pin.name,
                "note": pin.note,
                "x": pin.x,
                "y": pin.y,
                "label_side": pin.label_side.value,
                "color": pin.color.value,
                "master_only": pin.master_only,
            }
            for m in maps
            for pin in m.geo.pins
        ],
    )
    await _insert(
        session,
        RelationshipMapLinkRow,
        [
            {
                "id": link.id,
                "map_id": m.map.id,
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
            for m in maps
            for link in m.geo.links
        ],
    )
    await _insert(
        session,
        DocumentLinkedMapRow,
        [
            {
                "document_id": document_id,
                "map_id": m.map.id,
                "linked_by": linked_by,
                "linked_at": now,
            }
            for m in maps
            for document_id in m.linked_document_ids
        ],
    )

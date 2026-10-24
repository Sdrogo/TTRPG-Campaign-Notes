"""Relationship maps (spec 28_1): the map rows, their Selective grants and
their boards (groups, cards, arrows). Nothing here filters for a viewer: the
routes do, through `app.domain.relationship_maps`."""

import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    DocumentLinkedMapRow,
    RelationshipMapArrowRow,
    RelationshipMapCardRow,
    RelationshipMapGrantRow,
    RelationshipMapGroupRow,
    RelationshipMapRow,
)
from app.domain.models import DocumentVisibility
from app.domain.relationship_maps import (
    ArrowDirection,
    ArrowEnd,
    Board,
    BoardPlan,
    CardSize,
    MapArrow,
    MapCard,
    MapColor,
    MapGroup,
    MapKind,
    RelationshipMap,
)


def _map_from_row(row: RelationshipMapRow) -> RelationshipMap:
    """Maps a `relationship_maps` row to the domain map."""
    return RelationshipMap(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        description=row.description,
        visibility=DocumentVisibility(row.visibility),
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
        source_document_id=row.source_document_id,
        mention_depth=row.mention_depth,
        kind=MapKind(row.kind),
        plane_width=row.plane_width,
        plane_height=row.plane_height,
        background_path=row.background_path,
        players_can_edit=row.players_can_edit,
        revision=row.revision,
    )


def _group_from_row(row: RelationshipMapGroupRow) -> MapGroup:
    """Maps a group row to the domain group."""
    return MapGroup(
        id=row.id,
        title=row.title,
        color=MapColor(row.color),
        struck=row.struck,
        x=row.x,
        y=row.y,
        width=row.width,
        height=row.height,
    )


def _card_from_row(row: RelationshipMapCardRow) -> MapCard:
    """Maps a card row to the domain card."""
    return MapCard(
        id=row.id,
        document_id=row.document_id,
        text=row.text,
        group_id=row.group_id,
        caption=row.caption,
        image_id=row.image_id,
        size=CardSize(row.size),
        master_only=row.master_only,
        color=MapColor(row.color),
        struck=row.struck,
        x=row.x,
        y=row.y,
    )


def _arrow_from_row(row: RelationshipMapArrowRow) -> MapArrow:
    """Maps an arrow row to the domain arrow."""
    return MapArrow(
        id=row.id,
        from_end=ArrowEnd(card_id=row.from_card_id, group_id=row.from_group_id),
        to_end=ArrowEnd(card_id=row.to_card_id, group_id=row.to_group_id),
        direction=ArrowDirection(row.direction),
        label=row.label,
        reverse_label=row.reverse_label,
        label_position=row.label_position,
        reverse_label_position=row.reverse_label_position,
        label_offset=row.label_offset,
        reverse_label_offset=row.reverse_label_offset,
        color=MapColor(row.color),
        master_only=row.master_only,
    )


async def insert_map(
    session: AsyncSession,
    relationship_map: RelationshipMap,
    selective_user_ids: Collection[uuid.UUID],
) -> None:
    """Inserts a new, empty map and its Selective grants."""
    session.add(
        RelationshipMapRow(
            id=relationship_map.id,
            room_id=relationship_map.room_id,
            name=relationship_map.name,
            description=relationship_map.description,
            visibility=relationship_map.visibility.value,
            created_by=relationship_map.created_by,
            created_at=relationship_map.created_at,
            updated_at=relationship_map.updated_at,
            source_document_id=relationship_map.source_document_id,
            mention_depth=relationship_map.mention_depth,
            kind=relationship_map.kind.value,
            plane_width=relationship_map.plane_width,
            plane_height=relationship_map.plane_height,
            background_path=relationship_map.background_path,
        )
    )
    await session.flush()
    await set_map_grants(session, relationship_map.id, selective_user_ids)


async def get_map(session: AsyncSession, map_id: uuid.UUID) -> RelationshipMap | None:
    """The map, or None. Not yet checked against any viewer."""
    row = await session.get(RelationshipMapRow, map_id)
    return _map_from_row(row) if row else None


async def get_mention_map(session: AsyncSession, document_id: uuid.UUID) -> RelationshipMap | None:
    """The Document's mention map (spec 36), or None. Not yet checked against
    any viewer."""
    result = await session.execute(
        select(RelationshipMapRow).where(RelationshipMapRow.source_document_id == document_id)
    )
    row = result.scalar_one_or_none()
    return _map_from_row(row) if row else None


async def get_linked_map_id(session: AsyncSession, document_id: uuid.UUID) -> uuid.UUID | None:
    """The free map linked to the Document (spec 36 Decision 15), or None."""
    result = await session.execute(
        select(DocumentLinkedMapRow.map_id).where(DocumentLinkedMapRow.document_id == document_id)
    )
    return result.scalar_one_or_none()


async def link_map(
    session: AsyncSession,
    document_id: uuid.UUID,
    map_id: uuid.UUID,
    linked_by: uuid.UUID,
    linked_at: datetime,
) -> None:
    """Links the map to the Document, replacing any map linked before."""
    values = {"map_id": map_id, "linked_by": linked_by, "linked_at": linked_at}
    await session.execute(
        insert(DocumentLinkedMapRow)
        .values(document_id=document_id, **values)
        .on_conflict_do_update(index_elements=["document_id"], set_=values)
    )


async def list_linked_documents(
    session: AsyncSession, map_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The Documents that show each of these maps on their page (spec 36
    Decision 15), in one query. A map no Document shows maps to an empty
    list."""
    linked: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if map_ids:
        rows = await session.execute(
            select(DocumentLinkedMapRow.map_id, DocumentLinkedMapRow.document_id)
            .where(DocumentLinkedMapRow.map_id.in_(map_ids))
            .order_by(DocumentLinkedMapRow.document_id)
        )
        for map_id, document_id in rows:
            linked[map_id].append(document_id)
    return linked


async def unlink_map(session: AsyncSession, document_id: uuid.UUID) -> None:
    """Removes the Document's linked map, if any; the map stays."""
    await session.execute(
        delete(DocumentLinkedMapRow).where(DocumentLinkedMapRow.document_id == document_id)
    )


async def lock_map(session: AsyncSession, map_id: uuid.UUID) -> RelationshipMap | None:
    """Takes the map's row lock until the transaction ends and returns it as
    of the lock (re-read, not taken from the session's cache), or None when
    it is gone: board saves and edits of one map serialize on it."""
    result = await session.execute(
        select(RelationshipMapRow)
        .where(RelationshipMapRow.id == map_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    row = result.scalar_one_or_none()
    return _map_from_row(row) if row else None


async def list_maps_for_room(session: AsyncSession, room_id: uuid.UUID) -> list[RelationshipMap]:
    """Every free map of the Room, last edited first; mention maps (spec 36)
    live on their Document's page and are left out. Not yet filtered for
    any viewer."""
    result = await session.execute(
        select(RelationshipMapRow)
        .where(
            RelationshipMapRow.room_id == room_id,
            RelationshipMapRow.source_document_id.is_(None),
        )
        .order_by(RelationshipMapRow.updated_at.desc(), RelationshipMapRow.id)
    )
    return [_map_from_row(row) for row in result.scalars()]


async def list_every_map_for_room(
    session: AsyncSession, room_id: uuid.UUID
) -> list[RelationshipMap]:
    """Every map of the Room, mention maps (spec 36) included, in a fixed
    order: a Room's duplication copies them all (spec 40)."""
    result = await session.execute(
        select(RelationshipMapRow)
        .where(RelationshipMapRow.room_id == room_id)
        .order_by(RelationshipMapRow.created_at, RelationshipMapRow.id)
    )
    return [_map_from_row(row) for row in result.scalars()]


async def count_maps_for_room(session: AsyncSession, room_id: uuid.UUID) -> int:
    """How many free maps the Room has, whoever can see them (Decision 11);
    mention maps are one per Document and don't count (spec 36)."""
    result = await session.execute(
        select(func.count())
        .select_from(RelationshipMapRow)
        .where(
            RelationshipMapRow.room_id == room_id,
            RelationshipMapRow.source_document_id.is_(None),
        )
    )
    return result.scalar_one()


async def update_map(session: AsyncSession, relationship_map: RelationshipMap) -> RelationshipMap:
    """Writes a map's name, description, visibility, mention depth, plane
    size (spec 38), Players' switch (spec 42) and `updated_at`, and raises
    its revision by one (spec 42 Decision 7: every write counts). Returns
    `relationship_map` with that revision. Raises `LookupError` if it no longer exists."""
    row = await session.get(RelationshipMapRow, relationship_map.id)
    if row is None:
        raise LookupError(f"Map {relationship_map.id} not found")
    row.name = relationship_map.name
    row.description = relationship_map.description
    row.visibility = relationship_map.visibility.value
    row.mention_depth = relationship_map.mention_depth
    row.plane_width = relationship_map.plane_width
    row.plane_height = relationship_map.plane_height
    row.players_can_edit = relationship_map.players_can_edit
    row.updated_at = relationship_map.updated_at
    row.revision = row.revision + 1
    await session.flush()
    return replace(relationship_map, revision=row.revision)


async def set_background(session: AsyncSession, map_id: uuid.UUID, path: str | None) -> None:
    """Points a geographic map at a new background image (None removes it,
    spec 38 Decision 2)."""
    await session.execute(
        update(RelationshipMapRow)
        .where(RelationshipMapRow.id == map_id)
        .values(background_path=path)
    )
    await session.flush()


async def list_background_paths_in_room(session: AsyncSession, room_id: uuid.UUID) -> list[str]:
    """The Storage paths of the Room's maps' background images, for the
    Room's deletion to remove them from Storage (the rows cascade)."""
    result = await session.execute(
        select(RelationshipMapRow.background_path).where(
            RelationshipMapRow.room_id == room_id,
            RelationshipMapRow.background_path.is_not(None),
        )
    )
    return [path for path in result.scalars() if path is not None]


async def delete_map(session: AsyncSession, map_id: uuid.UUID) -> None:
    """Deletes the map; its grants, groups, cards and arrows cascade."""
    await session.execute(delete(RelationshipMapRow).where(RelationshipMapRow.id == map_id))
    await session.flush()


async def list_grants_for_maps(
    session: AsyncSession, map_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """The Selective grantees of each map. A map with none maps to an empty
    list."""
    grants: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    if not map_ids:
        return grants
    result = await session.execute(
        select(RelationshipMapGrantRow.map_id, RelationshipMapGrantRow.user_id).where(
            RelationshipMapGrantRow.map_id.in_(map_ids)
        )
    )
    for map_id, user_id in result.tuples():
        grants[map_id].append(user_id)
    return grants


async def set_map_grants(
    session: AsyncSession, map_id: uuid.UUID, user_ids: Collection[uuid.UUID]
) -> None:
    """Replaces the map's Selective grantees with `user_ids`."""
    await session.execute(
        delete(RelationshipMapGrantRow).where(RelationshipMapGrantRow.map_id == map_id)
    )
    for user_id in set(user_ids):
        session.add(RelationshipMapGrantRow(map_id=map_id, user_id=user_id))
    await session.flush()


async def list_cards_for_maps(
    session: AsyncSession, map_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[MapCard]]:
    """The cards of each map in one query (the list's Document counts). A map
    with none maps to an empty list."""
    cards: dict[uuid.UUID, list[MapCard]] = defaultdict(list)
    if not map_ids:
        return cards
    result = await session.execute(
        select(RelationshipMapCardRow).where(RelationshipMapCardRow.map_id.in_(map_ids))
    )
    for row in result.scalars():
        cards[row.map_id].append(_card_from_row(row))
    return cards


async def get_boards(session: AsyncSession, map_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Board]:
    """Everything on each of these maps, in three queries whatever their
    number, ordered so a board reads the same on every load. A map with
    nothing on it maps to an empty `Board`. Not yet filtered for any
    viewer."""
    groups: dict[uuid.UUID, list[MapGroup]] = defaultdict(list)
    cards: dict[uuid.UUID, list[MapCard]] = defaultdict(list)
    arrows: dict[uuid.UUID, list[MapArrow]] = defaultdict(list)
    if map_ids:
        group_rows = await session.execute(
            select(RelationshipMapGroupRow)
            .where(RelationshipMapGroupRow.map_id.in_(map_ids))
            .order_by(RelationshipMapGroupRow.id)
        )
        for group_row in group_rows.scalars():
            groups[group_row.map_id].append(_group_from_row(group_row))
        card_rows = await session.execute(
            select(RelationshipMapCardRow)
            .where(RelationshipMapCardRow.map_id.in_(map_ids))
            .order_by(RelationshipMapCardRow.id)
        )
        for card_row in card_rows.scalars():
            cards[card_row.map_id].append(_card_from_row(card_row))
        arrow_rows = await session.execute(
            select(RelationshipMapArrowRow)
            .where(RelationshipMapArrowRow.map_id.in_(map_ids))
            .order_by(RelationshipMapArrowRow.id)
        )
        for arrow_row in arrow_rows.scalars():
            arrows[arrow_row.map_id].append(_arrow_from_row(arrow_row))
    return {
        map_id: Board(groups=groups[map_id], cards=cards[map_id], arrows=arrows[map_id])
        for map_id in map_ids
    }


async def find_foreign_ids(
    session: AsyncSession, map_id: uuid.UUID, ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these ids already name a group, card or arrow of another map:
    a board save may not take them over (`plan_board_edit`)."""
    if not ids:
        return set()
    found: set[uuid.UUID] = set()
    for model in (RelationshipMapGroupRow, RelationshipMapCardRow, RelationshipMapArrowRow):
        result = await session.execute(
            select(model.id).where(model.id.in_(ids), model.map_id != map_id)
        )
        found.update(result.scalars())
    return found


async def save_board(session: AsyncSession, map_id: uuid.UUID, plan: BoardPlan) -> None:
    """Applies a board save (`plan_board_edit`): deletions first, so a
    Document taken off and put back in one save doesn't collide with its old
    card, then the groups, cards and arrows the editor sent, created or
    rewritten. A deleted card or group takes the arrows touching it with it,
    and leaves the cards it held outside any group. Callers hold the map's
    lock (`lock_map`)."""
    for model, ids in (
        (RelationshipMapArrowRow, plan.delete_arrow_ids),
        (RelationshipMapCardRow, plan.delete_card_ids),
        (RelationshipMapGroupRow, plan.delete_group_ids),
    ):
        if ids:
            await session.execute(
                delete(model).where(model.map_id == map_id, model.id.in_(list(ids)))
            )

    if plan.groups:
        statement = insert(RelationshipMapGroupRow).values(
            [
                {
                    "id": group.id,
                    "map_id": map_id,
                    "title": group.title,
                    "color": group.color.value,
                    "struck": group.struck,
                    "x": group.x,
                    "y": group.y,
                    "width": group.width,
                    "height": group.height,
                }
                for group in plan.groups
            ]
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    column: statement.excluded[column]
                    for column in ("title", "color", "struck", "x", "y", "width", "height")
                },
            )
        )
    if plan.cards:
        statement = insert(RelationshipMapCardRow).values(
            [
                {
                    "id": card.id,
                    "map_id": map_id,
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
                for card in plan.cards
            ]
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    column: statement.excluded[column]
                    for column in (
                        "group_id",
                        "text",
                        "caption",
                        "image_id",
                        "size",
                        "master_only",
                        "color",
                        "struck",
                        "x",
                        "y",
                    )
                },
            )
        )
    if plan.arrows:
        statement = insert(RelationshipMapArrowRow).values(
            [
                {
                    "id": arrow.id,
                    "map_id": map_id,
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
                for arrow in plan.arrows
            ]
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    column: statement.excluded[column]
                    for column in (
                        "from_card_id",
                        "from_group_id",
                        "to_card_id",
                        "to_group_id",
                        "direction",
                        "label",
                        "reverse_label",
                        "label_position",
                        "reverse_label_position",
                        "label_offset",
                        "reverse_label_offset",
                        "color",
                        "master_only",
                    )
                },
            )
        )
    # Core statements bypass the ORM: what this session cached is stale now.
    await session.flush()
    session.expire_all()

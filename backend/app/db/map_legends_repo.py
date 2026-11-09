"""Relation color legend presets of a Room (spec 68) and the maps linked to
them. Nothing here checks who asks: the routes do, through
`app.domain.map_legends`."""

import uuid
from collections.abc import Collection
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import RelationshipMapLegendPresetRow, RelationshipMapRow
from app.db.relationship_maps_repo import legend_from_json, legend_to_json, map_from_row
from app.domain.map_legends import LegendPreset
from app.domain.relationship_maps import RelationshipMap


def _preset_from_row(row: RelationshipMapLegendPresetRow) -> LegendPreset:
    """Maps a `relationship_map_legend_presets` row to the domain preset."""
    return LegendPreset(
        id=row.id,
        room_id=row.room_id,
        name=row.name,
        entries=legend_from_json(row.entries),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_presets(session: AsyncSession, room_id: uuid.UUID) -> list[LegendPreset]:
    """The Room's presets, by name."""
    result = await session.execute(
        select(RelationshipMapLegendPresetRow)
        .where(RelationshipMapLegendPresetRow.room_id == room_id)
        .order_by(RelationshipMapLegendPresetRow.name, RelationshipMapLegendPresetRow.id)
    )
    return [_preset_from_row(row) for row in result.scalars()]


async def get_preset(session: AsyncSession, preset_id: uuid.UUID) -> LegendPreset | None:
    """The preset, or None. Not yet checked against any Room."""
    row = await session.get(RelationshipMapLegendPresetRow, preset_id)
    return _preset_from_row(row) if row else None


async def count_presets(session: AsyncSession, room_id: uuid.UUID) -> int:
    """How many presets the Room has (Decision 19's cap)."""
    result = await session.execute(
        select(func.count())
        .select_from(RelationshipMapLegendPresetRow)
        .where(RelationshipMapLegendPresetRow.room_id == room_id)
    )
    return result.scalar_one()


async def preset_names(session: AsyncSession, room_id: uuid.UUID) -> set[str]:
    """The names the Room's presets already use."""
    result = await session.execute(
        select(RelationshipMapLegendPresetRow.name).where(
            RelationshipMapLegendPresetRow.room_id == room_id
        )
    )
    return set(result.scalars())


async def insert_presets(session: AsyncSession, presets: Collection[LegendPreset]) -> None:
    """Inserts new presets (their names already unique in their Room)."""
    for preset in presets:
        session.add(
            RelationshipMapLegendPresetRow(
                id=preset.id,
                room_id=preset.room_id,
                name=preset.name,
                entries=legend_to_json(preset.entries) or {},
                created_at=preset.created_at,
                updated_at=preset.updated_at,
            )
        )
    await session.flush()


async def update_preset(session: AsyncSession, preset: LegendPreset) -> None:
    """Writes a preset's name, meanings and `updated_at`."""
    row = await session.get(RelationshipMapLegendPresetRow, preset.id)
    if row is None:  # pragma: no cover - only a concurrent deletion
        raise LookupError(f"Preset {preset.id} not found")
    row.name = preset.name
    row.entries = legend_to_json(preset.entries) or {}
    row.updated_at = preset.updated_at
    await session.flush()


async def delete_preset(session: AsyncSession, preset_id: uuid.UUID) -> None:
    """Deletes the preset; maps still linked to it lose the link
    (`ON DELETE SET NULL`), so copy its meanings into them first."""
    row = await session.get(RelationshipMapLegendPresetRow, preset_id)
    if row is not None:
        await session.delete(row)
        await session.flush()


async def lock_linked_maps(session: AsyncSession, preset_id: uuid.UUID) -> list[RelationshipMap]:
    """The maps linked to the preset, under their row locks (re-read), so a
    preset edit or delete serializes with their board saves."""
    result = await session.execute(
        select(RelationshipMapRow)
        .where(RelationshipMapRow.legend_preset_id == preset_id)
        .order_by(RelationshipMapRow.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return [map_from_row(row) for row in result.scalars()]


async def count_linked_maps(
    session: AsyncSession, preset_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """How many maps link to each preset (Decision 23's list shows it)."""
    counts = dict.fromkeys(preset_ids, 0)
    if not counts:
        return counts
    result = await session.execute(
        select(RelationshipMapRow.legend_preset_id, func.count())
        .where(RelationshipMapRow.legend_preset_id.in_(counts.keys()))
        .group_by(RelationshipMapRow.legend_preset_id)
    )
    # `in_` leaves out the maps with no link, so every id is a preset's.
    for preset_id, count in result.tuples():
        counts[cast(uuid.UUID, preset_id)] = count
    return counts

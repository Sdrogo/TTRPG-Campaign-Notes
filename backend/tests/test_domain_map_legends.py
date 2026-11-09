import uuid
from datetime import UTC, datetime

import pytest

from app.db.relationship_maps_repo import legend_from_json, legend_to_json
from app.domain.map_legends import (
    MAX_PRESETS_PER_ROOM,
    EmptyPresetError,
    LegendPreset,
    PresetNameRequiredError,
    TooManyPresetsError,
    can_manage_presets,
    clean_meanings,
    clean_preset,
    effective_meanings,
    ensure_room_for_another_preset,
)
from app.domain.models import DocumentVisibility, RoomRole
from app.domain.relationship_maps import MapColor, MapTextTooLongError, RelationshipMap

NOW = datetime(2026, 11, 9, tzinfo=UTC)


def _map(**fields: object) -> RelationshipMap:
    return RelationshipMap(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        name="Court",
        description="",
        visibility=DocumentVisibility.ROOM,
        created_by=uuid.uuid4(),
        created_at=NOW,
        updated_at=NOW,
        **fields,  # type: ignore[arg-type]
    )


def test_meanings_are_trimmed_ordered_and_limited() -> None:
    cleaned = clean_meanings({MapColor.PINK: " Love  interest ", MapColor.RED: "Rival"})
    assert list(cleaned.items()) == [(MapColor.RED, "Rival"), (MapColor.PINK, "Love interest")]
    assert clean_meanings({MapColor.RED: "   "}) == {}
    with pytest.raises(MapTextTooLongError):
        clean_meanings({MapColor.RED: "x" * 41})


def test_a_preset_needs_a_name_and_a_meaning() -> None:
    assert clean_preset(" Court ", {MapColor.RED: "Rival"}) == ("Court", {MapColor.RED: "Rival"})
    with pytest.raises(PresetNameRequiredError):
        clean_preset("  ", {MapColor.RED: "Rival"})
    with pytest.raises(EmptyPresetError):
        clean_preset("Court", {MapColor.RED: " "})
    with pytest.raises(MapTextTooLongError):
        clean_preset("x" * 61, {MapColor.RED: "Rival"})


def test_only_the_master_manages_presets_up_to_the_cap() -> None:
    assert can_manage_presets(RoomRole.MASTER) and not can_manage_presets(RoomRole.PLAYER)
    ensure_room_for_another_preset(MAX_PRESETS_PER_ROOM - 1)
    with pytest.raises(TooManyPresetsError):
        ensure_room_for_another_preset(MAX_PRESETS_PER_ROOM)


def test_a_linked_map_means_what_its_preset_says() -> None:
    preset = LegendPreset(uuid.uuid4(), uuid.uuid4(), "Court", {MapColor.RED: "Enemy"}, NOW, NOW)
    linked = _map(legend_preset_id=preset.id)
    own = _map(color_legend={MapColor.GREEN: "Ally"})
    assert effective_meanings(linked, {preset.id: preset}) == {MapColor.RED: "Enemy"}
    assert effective_meanings(own, {preset.id: preset}) == {MapColor.GREEN: "Ally"}
    # A link to a preset not at hand falls back to the map's own (none).
    assert effective_meanings(linked, {}) == {}


def test_stored_meanings_skip_colors_the_palette_lacks() -> None:
    assert legend_from_json({"red": "Rival", "teal": "Gone"}) == {MapColor.RED: "Rival"}
    assert legend_from_json(None) == {}
    assert legend_to_json({}) is None
    assert legend_to_json({MapColor.RED: "Rival"}) == {"red": "Rival"}

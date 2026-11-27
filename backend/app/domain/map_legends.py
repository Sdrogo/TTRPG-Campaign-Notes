"""Color legends (spec 68): a meaning per palette color, either the map's
own or a Room preset the map stays linked to (Decision 20). A free map's
legend tells its relation colors, a geographic map's its area colors (spec
77b); each preset is of one kind and serves only maps of that kind
(77b Decision 8). Meanings are plain text written by the users, never
translated (Decision 2).

Who may do what: a map's meanings change with its board, so whoever edits
the board (spec 42) changes them, links the map to a preset or unlinks it
(Decisions 6, 21, 22); only the Master creates, edits and deletes presets
(Decision 23). Presets are not secret: any member reads the list
(Decision 25)."""

import uuid
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.relationship_maps import MapColor, MapKind, RelationshipMap, clean_line

MAX_MEANING_LENGTH = 40
MAX_PRESET_NAME_LENGTH = 60
MAX_PRESETS_PER_ROOM = 30


class PresetNameRequiredError(DomainError):
    """A preset's name is empty once trimmed (Decision 19)."""


class EmptyPresetError(DomainError):
    """A preset has no meaning left once the empty ones are dropped: it must
    hold at least one (Decision 19)."""


class PresetNameTakenError(DomainError):
    """Another preset of the Room already has this name (Decision 19)."""


class TooManyPresetsError(DomainError):
    """The Room already has `MAX_PRESETS_PER_ROOM` presets (Decision 19)."""


class LegendKind(StrEnum):
    """What a legend's colors color: the relations of a free map or the
    areas of a geographic one (spec 77b Decision 8)."""

    RELATIONS = "relations"
    AREAS = "areas"


def legend_kind(map_kind: MapKind) -> LegendKind:
    """The kind of legend a map of `map_kind` has, and of the presets it may
    link to (spec 77b Decision 8)."""
    return LegendKind.AREAS if map_kind == MapKind.GEOGRAPHIC else LegendKind.RELATIONS


@dataclass(frozen=True)
class LegendPreset:
    """A Room's named set of color meanings (Decision 19), for relations or
    for areas (`kind`, spec 77b). Maps linked to it show `entries` live
    (Decision 20). Its name is unique in the Room among presets of its
    kind."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    entries: Mapping[MapColor, str]
    created_at: datetime
    updated_at: datetime
    kind: LegendKind = LegendKind.RELATIONS


def clean_meanings(meanings: Mapping[MapColor, str]) -> dict[MapColor, str]:
    """The meanings trimmed, the empty ones dropped (emptying a field removes
    it, Decision 2), in palette order; one over `MAX_MEANING_LENGTH`
    characters raises `MapTextTooLongError` (422)."""
    cleaned: dict[MapColor, str] = {}
    for color in MapColor:
        if color not in meanings:
            continue
        meaning = clean_line(meanings[color], MAX_MEANING_LENGTH, "legendMeaning")
        if meaning is not None:
            cleaned[color] = meaning
    return cleaned


def clean_preset(name: str, entries: Mapping[MapColor, str]) -> tuple[str, dict[MapColor, str]]:
    """A preset's name and meanings, cleaned: a name of 1 to
    `MAX_PRESET_NAME_LENGTH` characters and at least one meaning, else 422
    (`PresetNameRequiredError`, `MapTextTooLongError`, `EmptyPresetError`)."""
    cleaned_name = clean_line(name, MAX_PRESET_NAME_LENGTH, "presetName")
    if cleaned_name is None:
        raise PresetNameRequiredError("errors.map.presetNameRequired")
    cleaned = clean_meanings(entries)
    if not cleaned:
        raise EmptyPresetError("errors.map.presetEmpty")
    return cleaned_name, cleaned


def can_manage_presets(role: RoomRole) -> bool:
    """Only the Master creates, edits and deletes a Room's presets
    (Decision 23)."""
    return role == RoomRole.MASTER


def ensure_room_for_another_preset(current_count: int) -> None:
    """Raises `TooManyPresetsError` (409) when the Room is at its cap."""
    if current_count >= MAX_PRESETS_PER_ROOM:
        raise TooManyPresetsError("errors.map.tooManyPresets", max=MAX_PRESETS_PER_ROOM)


def effective_meanings(
    relationship_map: RelationshipMap, presets: Mapping[uuid.UUID, LegendPreset]
) -> dict[MapColor, str]:
    """What a map's legend means right now: its linked preset's meanings,
    read live from `presets` (Decision 20), else its own."""
    preset_id = relationship_map.legend_preset_id
    if preset_id is not None and preset_id in presets:
        return dict(presets[preset_id].entries)
    return dict(relationship_map.color_legend)


def hidden_colors(
    all_colors: Collection[MapColor], shown_colors: Collection[MapColor]
) -> set[MapColor]:
    """The area colors a viewer must not read a meaning for (spec 77b
    Decision 3): those of areas on the map (`all_colors`) that no area they
    see (`shown_colors`) uses. A meaning for a color no area uses is not
    hidden: it points at nothing."""
    return set(all_colors) - set(shown_colors)


def meanings_for_viewer(
    meanings: Mapping[MapColor, str], hidden: Collection[MapColor]
) -> dict[MapColor, str]:
    """`meanings` without those of the `hidden` colors (spec 77b Decision
    3), in palette order."""
    return {color: meaning for color, meaning in meanings.items() if color not in hidden}


def keep_hidden_meanings(
    sent: Mapping[MapColor, str],
    current: Mapping[MapColor, str],
    hidden: Collection[MapColor],
) -> dict[MapColor, str]:
    """The meanings an editor's save leaves on a geographic map: what they
    sent for the colors they see, and the current meanings of the `hidden`
    colors, which they never received and so can't have meant to change
    (spec 77b Decision 3, as the board keeps what they can't see)."""
    kept = {color: meaning for color, meaning in sent.items() if color not in hidden}
    kept.update({color: meaning for color, meaning in current.items() if color in hidden})
    return {color: kept[color] for color in MapColor if color in kept}

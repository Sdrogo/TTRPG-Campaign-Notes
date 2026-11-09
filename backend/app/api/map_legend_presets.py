"""Relation color legend presets of a Room (spec 68 Decisions 19-25): named
sets of color meanings the Room's free maps link to. Members only (403);
every member reads the list (presets are not secret, Decision 25), only the
Master writes it (Decision 23). A change reaches every linked map at once,
live (Decision 20); deleting a preset leaves each linked map a copy of its
meanings (Decision 23)."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.auth.dependencies import CurrentUserDep
from app.db import map_legends_repo, relationship_maps_repo
from app.db.session import SessionDep
from app.domain.map_legends import (
    EmptyPresetError,
    LegendPreset,
    PresetNameRequiredError,
    TooManyPresetsError,
    can_manage_presets,
    clean_preset,
    ensure_room_for_another_preset,
)
from app.domain.models import Membership
from app.domain.relationship_maps import MapColor, MapTextTooLongError, RelationshipMap
from app.i18n.dependencies import LocaleDep
from app.realtime.audience import push_map

router = APIRouter(prefix="/rooms/{room_id}/map-legend-presets", tags=["maps"])


class PresetResponse(BaseModel):
    """A preset: its meanings in palette order and how many maps link to it
    (Decision 23's list shows it)."""

    id: uuid.UUID
    name: str
    entries: dict[MapColor, str]
    map_count: int
    created_at: datetime
    updated_at: datetime


class PresetRequest(BaseModel):
    """A new preset: a name of 1 to 60 characters, unique in the Room, and at
    least one meaning of at most 40 characters (Decision 19)."""

    name: str
    entries: dict[MapColor, str]


class UpdatePresetRequest(BaseModel):
    """A partial update of a preset: omitted fields stay as they are."""

    name: str | None = None
    entries: dict[MapColor, str] | None = None


def _now() -> datetime:
    """The current time, in UTC."""
    return datetime.now(UTC)


def _response(preset: LegendPreset, map_count: int) -> PresetResponse:
    """A preset as returned."""
    return PresetResponse(
        id=preset.id,
        name=preset.name,
        entries=dict(preset.entries),
        map_count=map_count,
        created_at=preset.created_at,
        updated_at=preset.updated_at,
    )


async def _require_master(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> Membership:
    """The caller's membership, 403 unless they are the Room's Master
    (Decision 23)."""
    membership = await require_membership(session, room_id, user_id, locale)
    if not can_manage_presets(membership.role):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.map.notPresetManager", locale)
    return membership


async def _get_preset(
    session: AsyncSession, room_id: uuid.UUID, preset_id: uuid.UUID, locale: str
) -> LegendPreset:
    """The Room's preset, 404 when it doesn't exist or is another Room's."""
    preset = await map_legends_repo.get_preset(session, preset_id)
    if preset is None or preset.room_id != room_id:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.map.presetNotFound", locale)
    return preset


def _cleaned(
    name: str, entries: dict[MapColor, str], locale: str
) -> tuple[str, dict[MapColor, str]]:
    """`clean_preset`, its errors answered with 422."""
    try:
        return clean_preset(name, entries)
    except (PresetNameRequiredError, EmptyPresetError, MapTextTooLongError) as exc:
        raise translated_error(status.HTTP_422_UNPROCESSABLE_CONTENT, exc, locale) from exc


async def _push_maps(session: AsyncSession, maps: list[RelationshipMap]) -> None:
    """Tells who sees each of these maps that it changed (spec 43/52)."""
    grants = await relationship_maps_repo.list_grants_for_maps(session, [m.id for m in maps])
    for relationship_map in maps:
        await push_map(session, relationship_map, grants[relationship_map.id])


@router.get("")
async def list_presets(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[PresetResponse]:
    """The Room's presets, by name, for any member (Decision 25)."""
    await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    presets = await map_legends_repo.list_presets(session, room_id)
    counts = await map_legends_repo.count_linked_maps(session, [p.id for p in presets])
    return [_response(preset, counts[preset.id]) for preset in presets]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_preset(
    room_id: uuid.UUID,
    body: PresetRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> PresetResponse:
    """The Master saves a new preset ("Salva come preset", Decision 23). 409
    past 30 presets or when another one has the name."""
    await _require_master(session, room_id, uuid.UUID(current_user.id), locale)
    name, entries = _cleaned(body.name, body.entries, locale)
    try:
        ensure_room_for_another_preset(await map_legends_repo.count_presets(session, room_id))
    except TooManyPresetsError as exc:
        raise translated_error(status.HTTP_409_CONFLICT, exc, locale) from exc
    if name in await map_legends_repo.preset_names(session, room_id):
        raise http_error(status.HTTP_409_CONFLICT, "errors.map.presetNameTaken", locale)
    now = _now()
    preset = LegendPreset(uuid.uuid4(), room_id, name, entries, now, now)
    await map_legends_repo.insert_presets(session, [preset])
    return _response(preset, 0)


@router.patch("/{preset_id}")
async def update_preset(
    room_id: uuid.UUID,
    preset_id: uuid.UUID,
    body: UpdatePresetRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> PresetResponse:
    """The Master renames a preset or changes its meanings; every map linked
    to it shows the new meanings at once and is pushed live (Decision 20).
    409 when another preset has the new name."""
    await _require_master(session, room_id, uuid.UUID(current_user.id), locale)
    preset = await _get_preset(session, room_id, preset_id, locale)
    name, entries = _cleaned(
        preset.name if body.name is None else body.name,
        dict(preset.entries) if body.entries is None else body.entries,
        locale,
    )
    if name != preset.name and name in await map_legends_repo.preset_names(session, room_id):
        raise http_error(status.HTTP_409_CONFLICT, "errors.map.presetNameTaken", locale)
    now = _now()
    updated = replace(preset, name=name, entries=entries, updated_at=now)
    linked = await map_legends_repo.lock_linked_maps(session, preset_id)
    await map_legends_repo.update_preset(session, updated)
    touched = [
        await relationship_maps_repo.update_map(session, replace(m, updated_at=now)) for m in linked
    ]
    await _push_maps(session, touched)
    return _response(updated, len(linked))


@router.delete("/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_preset(
    room_id: uuid.UUID,
    preset_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """The Master deletes a preset. Each map linked to it first takes a copy
    of its meanings as its own, so no legend empties (Decision 23)."""
    await _require_master(session, room_id, uuid.UUID(current_user.id), locale)
    preset = await _get_preset(session, room_id, preset_id, locale)
    now = _now()
    linked = await map_legends_repo.lock_linked_maps(session, preset_id)
    touched = [
        await relationship_maps_repo.update_map(
            session,
            replace(m, legend_preset_id=None, color_legend=dict(preset.entries), updated_at=now),
        )
        for m in linked
    ]
    await map_legends_repo.delete_preset(session, preset_id)
    await _push_maps(session, touched)

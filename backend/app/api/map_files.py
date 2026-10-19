"""A geographic map as a JSON file (spec 38_3, Decision 10): importing one as
a new map, after a report of what it will create, and exporting a map back
to the same format. Members only (403). Importing takes the right to create
maps (spec 28 Decision 2) and never edits an existing map. Documents are
matched among those the requester sees, and the export holds only what they
see; both follow `X-View-As` like any read."""

import uuid
from typing import Any, Literal

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership, visible_documents
from app.api.errors import http_error, translated_error
from app.api.geographic_maps import GeoDetailResponse, geo_detail
from app.api.relationship_maps import get_visible_map, insert_map
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import documents_repo, geographic_maps_repo, rooms_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.geographic_maps import (
    MAX_BEND,
    InvalidPlaneError,
    LabelSide,
    placed_document_ids,
    visible_geo_board,
)
from app.domain.map_import import (
    SCHEMA_VERSION,
    ImportedArea,
    ImportedLink,
    ImportedPin,
    MapFile,
    MapImport,
    MapImportError,
    export_map_file,
    plan_map_import,
)
from app.domain.models import DocumentVisibility, Membership
from app.domain.relationship_maps import (
    ArrowDirection,
    InvalidBoardError,
    MapColor,
    MapKind,
    MapLimitError,
    MapTextTooLongError,
    MasterOnlyNotAllowedError,
    can_create_map,
)
from app.i18n.dependencies import LocaleDep

router = APIRouter(prefix="/rooms/{room_id}/maps", tags=["maps"])


class _FileModel(BaseModel):
    """Fields the file doesn't define are ignored, so a producer may add its
    own notes."""

    model_config = ConfigDict(extra="ignore")


class FilePlane(_FileModel):
    """The plane's size, in units."""

    width: int
    height: int


class FileArea(_FileModel):
    """An area of the file: `document` names a Document, or `name` describes a plain area."""

    key: str = Field(min_length=1)
    points: list[tuple[float, float]]
    document: str | None = None
    name: str | None = None
    subtitle: str | None = None
    note: str | None = None
    color: MapColor = MapColor.DEFAULT
    filled: bool = True
    dashed: bool = False
    master_only: bool = False


class FilePin(_FileModel):
    """A pin of the file, `document` as for an area."""

    key: str = Field(min_length=1)
    x: float
    y: float
    document: str | None = None
    name: str | None = None
    note: str | None = None
    label_side: LabelSide = LabelSide.RIGHT
    color: MapColor = MapColor.DEFAULT
    master_only: bool = False


class FileLink(_FileModel):
    """A link of the file, between the keys of two areas or pins."""

    from_key: str = Field(alias="from")
    to_key: str = Field(alias="to")
    direction: ArrowDirection = ArrowDirection.FORWARD
    label: str | None = None
    reverse_label: str | None = None
    color: MapColor = MapColor.DEFAULT
    bend: float | None = Field(default=None, ge=-MAX_BEND, le=MAX_BEND)
    master_only: bool = False


class MapFileBody(_FileModel):
    """The import file (`schema_version` 1), as documented in the spec 38
    ticket."""

    schema_version: int
    kind: Literal["geographic_map"]
    name: str
    description: str | None = None
    plane: FilePlane
    areas: list[FileArea] = []
    pins: list[FilePin] = []
    links: list[FileLink] = []


class ImportPreviewRequest(BaseModel):
    """The file to read, as it was parsed by the client."""

    map: dict[str, Any]


class ImportRequest(ImportPreviewRequest):
    """The file, and the new map's own fields: `name` and `description`
    replace the file's when given; without `visibility` the map starts at the
    Room's default (VR-05)."""

    name: str | None = None
    description: str | None = None
    visibility: DocumentVisibility | None = None
    selective_user_ids: UniqueIds = []


class ImportReportResponse(BaseModel):
    """What the import will create (Decision 10): the map's name and plane,
    how many areas, pins and links, how many are bound to a Document, and the
    names that will stay plain labels."""

    name: str
    description: str
    plane_width: int
    plane_height: int
    areas: int
    pins: int
    links: int
    matched: int
    not_found: list[str]
    ambiguous: list[str]
    repeated: list[str]


_IMPORT_ERROR_STATUS: dict[type[DomainError], int] = {
    MapImportError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidPlaneError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidBoardError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    MapTextTooLongError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    MasterOnlyNotAllowedError: status.HTTP_403_FORBIDDEN,
    MapLimitError: status.HTTP_409_CONFLICT,
}


def _read_file(raw: dict[str, Any], locale: str) -> MapFileBody:
    """The file's shape checked: 422 naming the first field at fault, or the
    version when it isn't one this App reads."""
    try:
        body = MapFileBody.model_validate(raw)
    except ValidationError as exc:
        error = exc.errors()[0]
        where = ".".join(str(part) for part in error["loc"]) or "-"
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "errors.mapImport.invalidFile",
            locale,
            field=where,
        ) from exc
    if body.schema_version != SCHEMA_VERSION:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "errors.mapImport.unsupportedVersion",
            locale,
            version=body.schema_version,
        )
    return body


def _map_file(body: MapFileBody) -> MapFile:
    """The checked file in domain terms."""
    return MapFile(
        name=body.name,
        description=body.description or "",
        plane_width=body.plane.width,
        plane_height=body.plane.height,
        areas=[
            ImportedArea(**{**area.model_dump(), "points": tuple(area.points)})
            for area in body.areas
        ],
        pins=[ImportedPin(**pin.model_dump()) for pin in body.pins],
        links=[ImportedLink(**link.model_dump()) for link in body.links],
    )


async def _plan(
    session: AsyncSession,
    room_id: uuid.UUID,
    membership: Membership,
    raw: dict[str, Any],
    locale: str,
) -> tuple[MapFile, MapImport]:
    """Reads the file and plans the new map: 403 unless the requester may
    create maps, then the file's own checks. Documents are matched among the
    Room's Documents the requester sees."""
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)
    if not can_create_map(membership.role, room.players_can_create_documents):
        raise http_error(status.HTTP_403_FORBIDDEN, "errors.map.creationDisabled", locale)
    map_file = _map_file(_read_file(raw, locale))
    documents = await visible_documents(
        session, await documents_repo.list_documents_for_room(session, room_id), membership
    )
    try:
        return map_file, plan_map_import(map_file, documents, membership.role)
    except tuple(_IMPORT_ERROR_STATUS) as exc:
        raise translated_error(_IMPORT_ERROR_STATUS[type(exc)], exc, locale) from exc


@router.post("/import/preview")
async def preview_map_import(
    room_id: uuid.UUID,
    body: ImportPreviewRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> ImportReportResponse:
    """Decision 10: what importing the file would create, before anything
    is: the counts and the names that matched no Document the requester sees,
    with the same refusals as the import itself. Nothing is written."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    map_file, planned = await _plan(session, room_id, membership, body.map, locale)
    report = planned.report
    return ImportReportResponse(
        name=map_file.name,
        description=map_file.description,
        plane_width=planned.plane_width,
        plane_height=planned.plane_height,
        areas=report.areas,
        pins=report.pins,
        links=report.links,
        matched=report.matched,
        not_found=list(report.not_found),
        ambiguous=list(report.ambiguous),
        repeated=list(report.repeated),
    )


@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_map(
    room_id: uuid.UUID,
    body: ImportRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """Decision 10: a new geographic map, owned by the requester, made from
    the file in one transaction. The background image is attached
    afterwards, like any map's. 403 unless the requester may create maps,
    409 over the caps (maps per Room, areas, pins, links), 422 for a file
    that can't become a map."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    map_file, planned = await _plan(session, room_id, membership, body.map, locale)
    relationship_map, grants = await insert_map(
        session,
        room_id,
        membership,
        body.name if body.name and body.name.strip() else map_file.name,
        locale,
        description=body.description if body.description is not None else map_file.description,
        visibility=body.visibility,
        selective_user_ids=body.selective_user_ids,
        kind=MapKind.GEOGRAPHIC,
        plane_width=planned.plane_width,
        plane_height=planned.plane_height,
    )
    await geographic_maps_repo.save_geo_board(session, relationship_map.id, planned.plan)
    return await geo_detail(session, relationship_map, grants, membership)


@router.get("/{map_id}/export")
async def export_map(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> dict[str, Any]:
    """Decision 10: the geographic map as an import file, built from the map
    as the requester sees it, so it holds no area, pin, link, name or note
    hidden from them. 404 when the map is hidden from them, 409 for a free
    map."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, _ = await get_visible_map(session, room_id, map_id, membership, locale)
    if relationship_map.kind != MapKind.GEOGRAPHIC:
        raise http_error(status.HTTP_409_CONFLICT, "errors.map.notGeographic", locale)
    assert relationship_map.plane_width is not None
    assert relationship_map.plane_height is not None
    board = (await geographic_maps_repo.get_geo_boards(session, [map_id]))[map_id]
    documents = await visible_documents(
        session,
        await documents_repo.get_documents_by_ids(
            session, placed_document_ids(board.areas, board.pins)
        ),
        membership,
    )
    shown = visible_geo_board(board, {document.id for document in documents}, membership.role)
    return export_map_file(
        relationship_map.name,
        relationship_map.description,
        relationship_map.plane_width,
        relationship_map.plane_height,
        shown,
        {document.id: document.name for document in documents},
    )

"""Geographic maps (spec 38_1): the areas, pins and links of a geographic map
and its background image. A map is created, listed, renamed and deleted by
the routes of `app.api.relationship_maps`, with `kind` `geographic`. Members
only (403); a map hidden from the requester is 404, checked before any
permission (VR-07); asking one kind of map for the other's content is 409.
Every read shows the map as the requester sees it (`visible_geo_board`,
Invariant 1) and follows `X-View-As` like any read."""

import uuid
from collections.abc import Collection
from dataclasses import replace
from datetime import UTC, datetime

from fastapi import APIRouter, UploadFile, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import get_visible_images_for_documents, require_membership, visible_documents
from app.api.errors import http_error, translated_error
from app.api.image_uploads import (
    ImageResponse,
    fetch_url,
    image_responses,
    normalize,
    read_upload,
    sign_images,
    upload_object,
)
from app.api.relationship_maps import (
    MapDocumentResponse,
    MapResponse,
    get_editable_map,
    get_managed_map,
    get_visible_map,
    map_summary,
    visible_document_ids,
)
from app.api.validation import UniqueIds
from app.auth.dependencies import CurrentUserDep
from app.db import (
    documents_repo,
    geographic_maps_repo,
    relationship_maps_repo,
    storage,
    storage_cleanup,
)
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.geographic_maps import (
    MAX_BACKGROUND_DIMENSION,
    Area,
    GeoBoard,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
    PlaceNameRequiredError,
    geo_document_count,
    merge_geo_changes,
    placed_document_ids,
    plan_background_path,
    plan_geo_board_edit,
    visible_geo_board,
)
from app.domain.models import Document, DocumentImage, Membership
from app.domain.relationship_maps import (
    MAX_LABEL_OFFSET,
    ArrowDirection,
    BoardDocumentNotFoundError,
    InvalidBoardError,
    MapColor,
    MapKind,
    MapLimitError,
    MapTextTooLongError,
    MasterOnlyNotAllowedError,
    RelationshipMap,
)
from app.i18n.dependencies import LocaleDep
from app.realtime.audience import push_map

router = APIRouter(prefix="/rooms/{room_id}/maps/{map_id}", tags=["maps"])


class AreaBody(BaseModel):
    """An area as sent and returned: a Document's area names `document_id`
    (its name and subtitle then follow the Document), a plain one carries
    `name`, `subtitle` and `note`. `points` are the corners in plane units, in
    order."""

    id: uuid.UUID
    document_id: uuid.UUID | None = None
    name: str | None = None
    subtitle: str | None = None
    note: str | None = None
    points: list[tuple[float, float]]
    color: MapColor = MapColor.DEFAULT
    dashed: bool = False
    filled: bool = True
    master_only: bool = False


class AreaResponse(AreaBody):
    """An area as returned, with its Document's look on a Document's area."""

    document: MapDocumentResponse | None


class PinBody(BaseModel):
    """A pin as sent and returned: a Document's pin names `document_id`, a
    plain one carries `name` and `note`."""

    id: uuid.UUID
    document_id: uuid.UUID | None = None
    name: str | None = None
    note: str | None = None
    x: float
    y: float
    label_side: LabelSide = LabelSide.RIGHT
    color: MapColor = MapColor.DEFAULT
    master_only: bool = False


class PinResponse(PinBody):
    """A pin as returned, with its Document's look on a Document's pin."""

    document: MapDocumentResponse | None


class LinkEndBody(BaseModel):
    """One end of a link: an area or a pin, exactly one of the two."""

    area_id: uuid.UUID | None = None
    pin_id: uuid.UUID | None = None


class LinkBody(BaseModel):
    """A link as sent and returned. `label` is the only label of a one-way
    link or a line, the one pointing at `to` on a two-way link;
    `reverse_label` the one pointing at `from_end`, two-way only. `bend` is how
    far the curve leaves the straight line between the ends (null for the
    default curve); the positions and offsets are those of a free map's arrow
    (spec 28 Decision 5)."""

    id: uuid.UUID
    from_end: LinkEndBody
    to_end: LinkEndBody
    direction: ArrowDirection = ArrowDirection.FORWARD
    label: str | None = None
    reverse_label: str | None = None
    bend: float | None = None
    label_position: float | None = Field(default=None, ge=0, le=1)
    reverse_label_position: float | None = Field(default=None, ge=0, le=1)
    label_offset: float | None = Field(default=None, ge=-MAX_LABEL_OFFSET, le=MAX_LABEL_OFFSET)
    reverse_label_offset: float | None = Field(
        default=None, ge=-MAX_LABEL_OFFSET, le=MAX_LABEL_OFFSET
    )
    color: MapColor = MapColor.DEFAULT
    master_only: bool = False


class GeoRequest(BaseModel):
    """The whole map as the editor sees it: new items with ids the client
    made up, the others with their own ids. What the editor sees and leaves
    out is deleted; what they can't see stays as it is. `base_revision` as
    on a free board (spec 42 Decision 7)."""

    base_revision: int | None = None
    areas: list[AreaBody] = []
    pins: list[PinBody] = []
    links: list[LinkBody] = []


class GeoChangesRequest(BaseModel):
    """What an editor changed on the map since their last save (spec 43
    Decision 1), as `BoardChangesRequest` on a free board: every created or
    changed area, pin and link, whole, `created_ids` naming the new ones,
    `deleted_ids` what they removed. `base_revision` is informative only."""

    base_revision: int | None = None
    areas: list[AreaBody] = []
    pins: list[PinBody] = []
    links: list[LinkBody] = []
    created_ids: UniqueIds = []
    deleted_ids: UniqueIds = []


class GeoDetailResponse(MapResponse):
    """A geographic map with its background (a short-lived signed link) and
    its content as the requester sees it (Invariant 1)."""

    background_url: str | None
    areas: list[AreaResponse]
    pins: list[PinResponse]
    links: list[LinkBody]


class BackgroundFromUrlRequest(BaseModel):
    """A background to import from a URL instead of uploading a file."""

    url: HttpUrl


def _now() -> datetime:
    """The current time, in UTC."""
    return datetime.now(UTC)


def _ensure_geographic(relationship_map: RelationshipMap, locale: str) -> None:
    """409 for a free map: its content is a board of cards (spec 38 Decision
    1)."""
    if relationship_map.kind != MapKind.GEOGRAPHIC:
        raise http_error(status.HTTP_409_CONFLICT, "errors.map.notGeographic", locale)


def link_body(link: Link) -> LinkBody:
    """A link as returned."""
    return LinkBody(
        id=link.id,
        from_end=LinkEndBody(area_id=link.from_end.area_id, pin_id=link.from_end.pin_id),
        to_end=LinkEndBody(area_id=link.to_end.area_id, pin_id=link.to_end.pin_id),
        direction=link.direction,
        label=link.label,
        reverse_label=link.reverse_label,
        bend=link.bend,
        label_position=link.label_position,
        reverse_label_position=link.reverse_label_position,
        label_offset=link.label_offset,
        reverse_label_offset=link.reverse_label_offset,
        color=link.color,
        master_only=link.master_only,
    )


async def _document_looks(
    session: AsyncSession,
    document_ids: Collection[uuid.UUID],
    documents: dict[uuid.UUID, Document],
    viewer: Membership,
) -> dict[uuid.UUID, MapDocumentResponse]:
    """What an area or pin shows of its Document: name, subtitle, lead image
    and Tags, in a fixed number of queries whatever the number of items.
    `documents` holds the Documents the viewer sees."""
    ids = list(document_ids)
    tags = await documents_repo.list_tag_ids_for_documents(session, ids)
    images = await get_visible_images_for_documents(session, ids, viewer)
    leads: dict[uuid.UUID, DocumentImage] = {
        document_id: document_images[0]
        for document_id, document_images in images.items()
        if document_images
    }
    urls = await sign_images(leads.values())
    looks: dict[uuid.UUID, MapDocumentResponse] = {}
    for document_id in ids:
        document = documents[document_id]
        lead = leads.get(document_id)
        signed: list[ImageResponse] = image_responses([lead], urls) if lead is not None else []
        looks[document_id] = MapDocumentResponse(
            id=document.id,
            name=document.name,
            subtitle=document.subtitle,
            image=signed[0] if signed else None,
            tag_ids=tags[document_id],
        )
    return looks


async def geo_detail(
    session: AsyncSession,
    relationship_map: RelationshipMap,
    grants: Collection[uuid.UUID],
    viewer: Membership,
) -> GeoDetailResponse:
    """The map and its content as `viewer` sees it."""
    board = (await geographic_maps_repo.get_geo_boards(session, [relationship_map.id]))[
        relationship_map.id
    ]
    on_map = placed_document_ids(board.areas, board.pins)
    documents = await documents_repo.get_documents_by_ids(session, on_map)
    visible = {
        document.id: document for document in await visible_documents(session, documents, viewer)
    }
    shown = visible_geo_board(board, visible.keys(), viewer.role)
    shown_ids = placed_document_ids(shown.areas, shown.pins)
    looks = await _document_looks(session, shown_ids, visible, viewer)
    background = None
    if relationship_map.background_path is not None:
        signed = await storage.signed_urls([relationship_map.background_path])
        background = signed.get(relationship_map.background_path)
    summary = map_summary(
        relationship_map, grants, viewer, geo_document_count(shown, visible.keys())
    )
    return GeoDetailResponse(
        **summary.model_dump(),
        background_url=background,
        areas=[
            AreaResponse(
                id=area.id,
                document_id=area.document_id,
                name=area.name,
                subtitle=area.subtitle,
                note=area.note,
                points=list(area.points),
                color=area.color,
                dashed=area.dashed,
                filled=area.filled,
                master_only=area.master_only,
                document=looks.get(area.document_id) if area.document_id else None,
            )
            for area in shown.areas
        ],
        pins=[
            PinResponse(
                id=pin.id,
                document_id=pin.document_id,
                name=pin.name,
                note=pin.note,
                x=pin.x,
                y=pin.y,
                label_side=pin.label_side,
                color=pin.color,
                master_only=pin.master_only,
                document=looks.get(pin.document_id) if pin.document_id else None,
            )
            for pin in shown.pins
        ],
        links=[link_body(link) for link in shown.links],
    )


def _link_end(end: LinkEndBody) -> LinkEnd:
    """A sent link end; 422 unless it names exactly one area or pin."""
    if (end.area_id is None) == (end.pin_id is None):
        raise InvalidBoardError("errors.map.invalidBoard")
    return LinkEnd(area_id=end.area_id, pin_id=end.pin_id)


def _submitted(body: GeoRequest | GeoChangesRequest) -> GeoBoard:
    """The map as sent, in domain terms (not yet checked)."""
    return GeoBoard(
        areas=[Area(**{**area.model_dump(), "points": tuple(area.points)}) for area in body.areas],
        pins=[Pin(**pin.model_dump()) for pin in body.pins],
        links=[
            Link(
                id=link.id,
                from_end=_link_end(link.from_end),
                to_end=_link_end(link.to_end),
                direction=link.direction,
                label=link.label,
                reverse_label=link.reverse_label,
                color=link.color,
                master_only=link.master_only,
                bend=link.bend,
                label_position=link.label_position,
                reverse_label_position=link.reverse_label_position,
                label_offset=link.label_offset,
                reverse_label_offset=link.reverse_label_offset,
            )
            for link in body.links
        ],
    )


_EDIT_ERROR_STATUS: dict[type[DomainError], int] = {
    InvalidBoardError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    MapTextTooLongError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    PlaceNameRequiredError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    BoardDocumentNotFoundError: status.HTTP_404_NOT_FOUND,
    MasterOnlyNotAllowedError: status.HTTP_403_FORBIDDEN,
    MapLimitError: status.HTTP_409_CONFLICT,
}


async def apply_geo_board(
    session: AsyncSession,
    relationship_map: RelationshipMap,
    membership: Membership,
    body: GeoRequest | GeoChangesRequest,
    locale: str,
) -> None:
    """Saves the map `membership` sends (`plan_geo_board_edit`): what they
    see is created, moved, rewritten or removed, what they can't see stays.
    Their changes alone (`GeoChangesRequest`, spec 43) are first laid over
    the stored map (`merge_geo_changes`). An area or pin for a Document they
    don't see, or of another Room, is 404; an id of something hidden from
    them or of another map is 422; the caps (409) count every item on the
    map. Callers hold the map's lock."""
    assert relationship_map.plane_width is not None
    assert relationship_map.plane_height is not None
    current = (await geographic_maps_repo.get_geo_boards(session, [relationship_map.id]))[
        relationship_map.id
    ]
    try:
        sent = _submitted(body)
        document_ids = placed_document_ids(
            [*current.areas, *sent.areas], [*current.pins, *sent.pins]
        )
        visible_ids = await visible_document_ids(session, document_ids, membership)
        shown = visible_geo_board(current, visible_ids, membership.role)
        submitted = (
            merge_geo_changes(current, shown, sent, body.created_ids, body.deleted_ids)
            if isinstance(body, GeoChangesRequest)
            else sent
        )
        sent_ids = (
            {area.id for area in submitted.areas}
            | {pin.id for pin in submitted.pins}
            | {link.id for link in submitted.links}
        )
        plan = plan_geo_board_edit(
            current,
            shown,
            submitted,
            membership.role,
            visible_ids,
            relationship_map.plane_width,
            relationship_map.plane_height,
            await geographic_maps_repo.find_foreign_ids(session, relationship_map.id, sent_ids),
        )
    except tuple(_EDIT_ERROR_STATUS) as exc:
        raise translated_error(_EDIT_ERROR_STATUS[type(exc)], exc, locale) from exc
    await geographic_maps_repo.save_geo_board(session, relationship_map.id, plan)


@router.get("/geo")
async def get_geo(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """The geographic map and its content as the requester sees it (spec 38
    Decision 6); 404 when it is hidden from them, 409 for a free map."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await get_visible_map(session, room_id, map_id, membership, locale)
    _ensure_geographic(relationship_map, locale)
    return await geo_detail(session, relationship_map, grants, membership)


@router.put("/geo")
async def save_geo(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    body: GeoRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """Decision 9: saves the map the editor sees, in one transaction under
    the map's lock: creates, moves, rewrites and removes what they see, and
    leaves what they can't see exactly as it is. 403 unless they may edit the
    map (its managers, or anyone who sees it while unlocked, spec 42); 412
    when someone else saved since `base_revision`; 409 for a free map."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await get_editable_map(
        session, room_id, map_id, membership, body.base_revision, locale
    )
    _ensure_geographic(relationship_map, locale)
    await apply_geo_board(session, relationship_map, membership, body, locale)
    updated = await relationship_maps_repo.update_map(
        session, replace(relationship_map, updated_at=_now())
    )
    await push_map(session, updated, grants)
    return await geo_detail(session, updated, grants, membership)


@router.patch("/geo")
async def save_geo_changes(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    body: GeoChangesRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """Spec 43: saves only what the editor changed, under the map's lock, and
    answers the whole map as they now see it, other editors' work included.
    A change to something deleted meanwhile, or hidden from them, is
    dropped; otherwise the rules of `PUT .../geo` apply. 403 unless they may
    edit the map (spec 42); 409 for a free map; never 412."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await get_editable_map(
        session, room_id, map_id, membership, None, locale
    )
    _ensure_geographic(relationship_map, locale)
    await apply_geo_board(session, relationship_map, membership, body, locale)
    updated = await relationship_maps_repo.update_map(
        session, replace(relationship_map, updated_at=_now())
    )
    await push_map(session, updated, grants)
    return await geo_detail(session, updated, grants, membership)


async def _replace_background(
    session: AsyncSession,
    relationship_map: RelationshipMap,
    grants: Collection[uuid.UUID],
    membership: Membership,
    new_path: str | None,
) -> GeoDetailResponse:
    """Points the map at `new_path` (None removes the background) and
    settles Storage in the same transaction: the new object is confirmed, the
    old one scheduled for removal after commit."""
    await relationship_maps_repo.set_background(session, relationship_map.id, new_path)
    if new_path is not None:
        await storage_cleanup.confirm_upload(session, new_path)
    if relationship_map.background_path is not None:
        await storage_cleanup.schedule_removal(session, [relationship_map.background_path])
    updated = await relationship_maps_repo.update_map(
        session, replace(relationship_map, background_path=new_path, updated_at=_now())
    )
    await push_map(session, updated, grants)
    return await geo_detail(session, updated, grants, membership)


async def _store_background(
    session: AsyncSession,
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    membership: Membership,
    data: bytes,
    locale: str,
) -> GeoDetailResponse:
    """Validates and re-encodes the image (not cropped, at most 4096 px on
    its longest side), uploads it and swaps it in. The file is validated
    before the map is locked, so a bad one doesn't hold the lock."""
    normalized = await normalize(data, locale, max_dimension=MAX_BACKGROUND_DIMENSION)
    relationship_map, grants = await get_managed_map(session, room_id, map_id, membership, locale)
    _ensure_geographic(relationship_map, locale)
    path = plan_background_path(room_id, map_id, normalized.extension)
    await upload_object(path, normalized, locale)
    return await _replace_background(session, relationship_map, grants, membership, path)


async def _check_manager(
    session: AsyncSession,
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    membership: Membership,
    locale: str,
) -> None:
    """404 when the map is hidden from `membership`, 403 unless they manage
    it, 409 unless it is geographic, before anything is uploaded or
    fetched."""
    relationship_map, _ = await get_managed_map(session, room_id, map_id, membership, locale)
    _ensure_geographic(relationship_map, locale)


@router.post("/background")
async def upload_background(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """Decision 2: replaces the map's background with an uploaded image
    (re-encoded as WebP, at most 4096 px on its longest side), stretched over
    the whole plane. 403 unless the requester manages the map, 409 for a free
    map, 413 for a file over the size limits, 422 for one that isn't a
    supported image."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    await _check_manager(session, room_id, map_id, membership, locale)
    data = await read_upload(file)
    return await _store_background(session, room_id, map_id, membership, data, locale)


@router.post("/background/from-url")
async def import_background(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    body: BackgroundFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """Decision 2: replaces the map's background with an image fetched from
    a URL (the image search of spec 29 hands one over). The same checks as an
    upload; 422 for a URL that can't be fetched safely."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    await _check_manager(session, room_id, map_id, membership, locale)
    data = await fetch_url(str(body.url), locale)
    return await _store_background(session, room_id, map_id, membership, data, locale)


@router.delete("/background")
async def remove_background(
    room_id: uuid.UUID,
    map_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> GeoDetailResponse:
    """Removes the map's background; the plane is then plain. 403 unless the
    requester manages the map, 409 for a free map."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    relationship_map, grants = await get_managed_map(session, room_id, map_id, membership, locale)
    _ensure_geographic(relationship_map, locale)
    return await _replace_background(session, relationship_map, grants, membership, None)

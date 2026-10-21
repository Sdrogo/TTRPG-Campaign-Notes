"""The Room export (FR-G1, UC-17, spec 23): the Room's content the requester
may see, as JSON for tools and Agents or Markdown for people, downloaded as a
file. It is read through the same visibility functions as every other read
path (Invariant 1, NFR-01, VR-07), in a fixed number of queries per kind, never
one per Document (NFR-04)."""

import json
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import (
    get_visible_document,
    get_visible_images_for_documents,
    require_membership,
)
from app.api.document_files import sign_files
from app.api.errors import http_error
from app.api.geographic_maps import AreaBody, LinkBody, PinBody
from app.api.image_uploads import sign_images
from app.api.relationship_maps import (
    ArrowBody,
    CardBody,
    GroupBody,
    visible_document_ids,
)
from app.auth.dependencies import CurrentUserDep
from app.db import (
    comments_repo,
    documents_repo,
    files_repo,
    geographic_maps_repo,
    notes_repo,
    relationship_maps_repo,
    rooms_repo,
    storage,
    tags_repo,
)
from app.db.session import SessionDep
from app.domain.export import (
    DocumentSource,
    Export,
    ExportFormat,
    ExportInput,
    build_export,
    document_export_filename,
    export_filename,
    render_json,
    render_markdown,
    restrict_to_document,
)
from app.domain.geographic_maps import GeoBoard, placed_document_ids, visible_geo_board
from app.domain.map_transfer import map_to_json
from app.domain.models import DocumentVisibility, Membership, Room
from app.domain.relationship_maps import (
    Board,
    MapKind,
    is_map_visible,
    visible_board,
)
from app.domain.tags import ordered_main_items
from app.domain.visibility import is_document_visible
from app.i18n.dependencies import LocaleDep

router = APIRouter(tags=["export"])


class TextSpanJson(BaseModel):
    """A run of plain text inside a description or a Comment."""

    type: str = "text"
    text: str


class MentionSpanJson(BaseModel):
    """A mention that resolved to something the requester sees: `kind` is
    `doc`, `tag` or `user`, `target_id` the id of that Document, Tag or
    member."""

    type: str = "mention"
    kind: str
    target_id: uuid.UUID
    name: str


Spans = list[TextSpanJson | MentionSpanJson]


class ImageJson(BaseModel):
    """An image as a signed link that expires, no bytes."""

    id: uuid.UUID
    url: str
    is_favorite: bool


class FileJson(BaseModel):
    """A PDF Attachment as a signed link that expires, no bytes."""

    id: uuid.UUID
    name: str
    size_bytes: int
    content_type: str
    url: str


class NoteJson(BaseModel):
    """A Note the requester sees. `selective_user_ids` is null unless they
    may manage it."""

    id: uuid.UUID
    title: str
    description: Spans
    position: int
    visibility: str
    selective_user_ids: list[uuid.UUID] | None


class CommentJson(BaseModel):
    """A Comment the requester sees, flat and oldest first: a reply points at
    its parent by `parent_id` (null for a top-level Comment and for a reply
    whose parent the requester can't see). `as_character_id` is the Document
    it was written as, only when the requester sees that Document."""

    id: uuid.UUID
    parent_id: uuid.UUID | None
    author_id: uuid.UUID
    as_character_id: uuid.UUID | None
    body: Spans
    created_at: datetime
    updated_at: datetime
    deleted: bool
    visibility: str
    selective_user_ids: list[uuid.UUID] | None
    images: list[ImageJson]


class DocumentJson(BaseModel):
    """A Document the requester sees. `selective_user_ids` is null unless
    they may manage it; `tag_ids`, `owner_ids` and `played_by` refer to
    objects listed at the top level of the export. `subtitle` is null when
    the Document has none (schema 2, spec 28_0)."""

    id: uuid.UUID
    name: str
    subtitle: str | None
    description: Spans
    visibility: str
    selective_user_ids: list[uuid.UUID] | None
    tag_ids: list[uuid.UUID]
    owner_ids: list[uuid.UUID]
    played_by: uuid.UUID | None
    images: list[ImageJson]
    files: list[FileJson]
    notes: list[NoteJson]
    comments: list[CommentJson]


class RoomJson(BaseModel):
    """The exported Room."""

    id: uuid.UUID
    name: str
    game_system: str | None


class MemberJson(BaseModel):
    """A member by name only; emails are never exported (NFR-03)."""

    id: uuid.UUID
    name: str | None


class TagJson(BaseModel):
    """A Tag of the Room."""

    id: uuid.UUID
    name: str
    category: str | None


class MapJson(BaseModel):
    """A map the requester sees (spec 40), with its content as they see it: a
    free map's `groups`, `cards` and `arrows`, a geographic map's `areas`,
    `pins` and `links` (the other lists are empty). `background_url` expires
    like the image links; `linked_document_ids` are the Documents of the file
    that show the map on their page."""

    id: uuid.UUID
    name: str
    description: str
    kind: MapKind
    visibility: DocumentVisibility
    plane_width: int | None
    plane_height: int | None
    background_url: str | None
    linked_document_ids: list[uuid.UUID]
    groups: list[GroupBody]
    cards: list[CardBody]
    arrows: list[ArrowBody]
    areas: list[AreaBody]
    pins: list[PinBody]
    links: list[LinkBody]


class ExportJson(BaseModel):
    """The JSON export (`schema_version` 3; 1 had no Document `subtitle`, 2 no
    `maps`).
    Every object carries its UUID and refers to others by id. `main_items` is
    the Room's grouping in order, each a list of Tag ids (one Tag, or a
    combination a Document belongs to when it carries all of them).
    `tag_filter` is null for a whole-Room export. Image and file links expire
    within `links_expire_within_seconds`. The same content as the Markdown
    file."""

    schema_version: int
    generated_at: datetime
    links_expire_within_seconds: int
    room: RoomJson
    tag_filter: list[uuid.UUID] | None
    members: list[MemberJson]
    tags: list[TagJson]
    main_items: list[list[uuid.UUID]]
    documents: list[DocumentJson]
    maps: list[MapJson]


EXPORT_MEDIA_TYPES = {
    ExportFormat.JSON: "application/json",
    ExportFormat.MARKDOWN: "text/markdown; charset=utf-8",
}


async def _document_sources(
    session: AsyncSession,
    room_id: uuid.UUID,
    viewer: Membership,
    tag_ids: list[uuid.UUID],
    document_id: uuid.UUID | None = None,
) -> tuple[list[DocumentSource], dict[uuid.UUID, str], dict[str, str], dict[str, str]]:
    """The Documents the viewer sees (and carry every Tag in `tag_ids`, and
    are `document_id` when it is given) with all their rows, the name of every
    Document they see, and the signed links of the images and files that
    survive the filters. Tags, images, files, Notes and Comments are read only
    for the Documents that survived the visibility filter (Invariant 1), each
    in one query for the whole Room."""
    documents = await documents_repo.list_documents_for_room(session, room_id)
    all_ids = [document.id for document in documents]
    owners = await documents_repo.list_owner_ids_for_documents(session, all_ids)
    grants = await documents_repo.list_selective_grant_ids_for_documents(session, all_ids)
    visible = [
        document
        for document in documents
        if is_document_visible(
            document, viewer.user_id, viewer.role, owners[document.id], grants[document.id]
        )
    ]
    visible_ids = [document.id for document in visible]
    tags = await documents_repo.list_tag_ids_for_documents(session, visible_ids)
    wanted = [
        document
        for document in visible
        if set(tag_ids) <= set(tags[document.id])
        and (document_id is None or document.id == document_id)
    ]
    ids = [document.id for document in wanted]

    images = await get_visible_images_for_documents(session, ids, viewer)
    files = await files_repo.list_files_for_documents(session, ids)
    notes = await notes_repo.list_notes_for_documents(session, ids)
    comments = await comments_repo.list_comments_for_documents(session, ids)
    note_grants = await notes_repo.list_grants_for_notes(
        session, [note.id for group in notes.values() for note in group]
    )
    comment_grants = await comments_repo.list_grants_for_comments(
        session, [comment.id for group in comments.values() for comment in group]
    )

    all_images = [image for group in images.values() for image in group]
    all_files = [file for group in files.values() for file in group]
    image_urls = await sign_images(all_images)
    signed_files = await sign_files(all_files)
    file_urls = {
        file.storage_path: storage.as_download(signed_files[file.storage_path], file.display_name)
        for file in all_files
        if file.storage_path in signed_files
    }
    sources = [
        DocumentSource(
            document=document,
            owner_ids=owners[document.id],
            selective_ids=grants[document.id],
            tag_ids=tags[document.id],
            images=images.get(document.id, []),
            files=files.get(document.id, []),
            notes=notes.get(document.id, []),
            note_grants=note_grants,
            comments=comments.get(document.id, []),
            comment_grants=comment_grants,
        )
        for document in wanted
    ]
    return sources, {d.id: d.name for d in visible}, image_urls, file_urls


async def load_export(
    session: AsyncSession,
    room: Room,
    viewer: Membership,
    tag_ids: list[uuid.UUID],
    document_id: uuid.UUID | None = None,
) -> Export:
    """The export tree of `room` for `viewer`, read now: everything they see
    (Invariant 1) and nothing else, narrowed to the Documents carrying every
    Tag in `tag_ids`. Shared by the file download and the Room PDF job, which
    calls it with the requester's (or the "as" member's) Membership when it
    starts, so the PDF is a snapshot of that moment (spec 23b Backend). With
    `document_id` the tree holds that Document alone (spec 27,
    `restrict_to_document`); the caller has checked the viewer sees it."""
    sources, visible_documents, image_urls, file_urls = await _document_sources(
        session, room.id, viewer, tag_ids, document_id
    )
    tags = await tags_repo.list_tags(session, room.id)
    combinations = await tags_repo.list_combinations(session, room.id)
    export = build_export(
        ExportInput(
            room=room,
            viewer=viewer,
            members=await rooms_repo.list_members_with_profile(session, room.id),
            tags=tags,
            main_items=ordered_main_items(tags, combinations),
            documents=sources,
            visible_documents=visible_documents,
            image_urls=image_urls,
            file_urls=file_urls,
            tag_filter=tag_ids,
            generated_at=datetime.now(UTC),
            link_ttl_seconds=storage.SIGNED_URL_TTL_SECONDS,
        )
    )
    return export if document_id is None else restrict_to_document(export, document_id)


async def export_maps(
    session: AsyncSession, room_id: uuid.UUID, viewer: Membership, export: Export
) -> list[dict[str, Any]]:
    """The Room's free and geographic maps `viewer` sees, each with its content
    as the map page shows it to them (spec 40 Decision 7, Invariant 1): a
    card, area or pin only for a Document they see, a card's chosen image
    only when it is one of the file's, the links to the pages of the file's
    Documents. Mention maps are left out. A fixed number of queries."""
    maps = await relationship_maps_repo.list_maps_for_room(session, room_id)
    grants = await relationship_maps_repo.list_grants_for_maps(session, [m.id for m in maps])
    shown = [m for m in maps if is_map_visible(m, viewer.user_id, viewer.role, grants[m.id])]
    ids = [m.id for m in shown]
    boards = await relationship_maps_repo.get_boards(
        session, [m.id for m in shown if m.kind is MapKind.FREE]
    )
    geo = await geographic_maps_repo.get_geo_boards(
        session, [m.id for m in shown if m.kind is MapKind.GEOGRAPHIC]
    )
    placed = [c.document_id for b in boards.values() for c in b.cards if c.document_id]
    placed += [d for g in geo.values() for d in placed_document_ids(g.areas, g.pins)]
    visible = await visible_document_ids(session, placed, viewer)
    in_file = {document.id for document in export.documents}
    images = {image.id for document in export.documents for image in document.images}
    linked = await relationship_maps_repo.list_linked_documents(session, ids)
    backgrounds = await storage.signed_urls([m.background_path for m in shown if m.background_path])
    result = []
    for relationship_map in shown:
        board = visible_board(boards.get(relationship_map.id, Board()), visible, viewer.role)
        board = replace(
            board,
            cards=[
                card if card.image_id in images else replace(card, image_id=None)
                for card in board.cards
            ],
        )
        result.append(
            map_to_json(
                relationship_map,
                board,
                visible_geo_board(geo.get(relationship_map.id, GeoBoard()), visible, viewer.role),
                backgrounds.get(relationship_map.background_path or ""),
                [d for d in linked[relationship_map.id] if d in in_file],
            )
        )
    return result


@router.get(
    "/rooms/{room_id}/export",
    response_class=Response,
    responses={
        status.HTTP_200_OK: {
            "description": "A file: the JSON export (`ExportJson`) or the Markdown one.",
            "content": {
                "application/json": {"schema": ExportJson.model_json_schema()},
                "text/markdown": {"schema": {"type": "string"}},
            },
        }
    },
)
async def export_room(
    room_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    export_format: Annotated[ExportFormat, Query(alias="format")] = ExportFormat.JSON,
    tag: Annotated[list[uuid.UUID] | None, Query()] = None,
) -> Response:
    """Downloads the Room as `<room>-<date>.json` or `.md` (`format`, JSON by
    default): the Room, its Tags and Main items, and the Documents the
    requester sees with their Notes, Comments and replies, mentions by id, and
    images and PDF Attachments as signed links that expire (no binaries). The
    JSON file also holds the maps they see (spec 40).
    Nothing the requester can't see is in it, and nothing about invitations,
    the AuditLog or member emails (VR-07, NFR-03). Each `tag` keeps only
    Documents carrying all of them (like the list filter). For members only
    (403 otherwise); 404 for a Tag of another Room. Not audited: it reads."""
    requester_id = uuid.UUID(current_user.id)
    viewer = await require_membership(session, room_id, requester_id, locale)
    tag_ids = list(dict.fromkeys(tag or []))
    if tag_ids and len(await tags_repo.get_tags_by_ids(session, room_id, tag_ids)) != len(tag_ids):
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.tag.notFound", locale)
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)

    export = await load_export(session, room, viewer, tag_ids)
    if export_format is ExportFormat.JSON:
        export = replace(export, maps=await export_maps(session, room_id, viewer, export))
    return _file_response(
        export, export_filename(room.name, export.generated_at, export_format), export_format
    )


@router.get(
    "/rooms/{room_id}/documents/{document_id}/export",
    response_class=Response,
    responses={
        status.HTTP_200_OK: {
            "description": "A file: the JSON export (`ExportJson`) holding one Document, or "
            "the Markdown one.",
            "content": {
                "application/json": {"schema": ExportJson.model_json_schema()},
                "text/markdown": {"schema": {"type": "string"}},
            },
        }
    },
)
async def export_document(
    room_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
    export_format: Annotated[ExportFormat, Query(alias="format")] = ExportFormat.JSON,
) -> Response:
    """Downloads one Document as `<document>-<date>.json` or `.md` (spec 27):
    the Room export with that Document alone, so the import reads it like any
    other. Exactly what the requester sees of it (VR-07, Invariant 1); its
    `tags` and `members` list only what it refers to. Every member who sees
    the Document may export it; 404 for one they can't see, as for the
    Document itself. Follows `X-View-As`. Not audited: it reads."""
    requester_id = uuid.UUID(current_user.id)
    viewer = await require_membership(session, room_id, requester_id, locale)
    document, _, _ = await get_visible_document(
        session, room_id, document_id, requester_id, viewer.role, locale
    )
    room = await rooms_repo.get_room(session, room_id)
    if room is None:  # pragma: no cover - only a concurrent Room deletion
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.room.notFound", locale)

    export = await load_export(session, room, viewer, [], document.id)
    return _file_response(
        export,
        document_export_filename(document.name, export.generated_at, export_format),
        export_format,
    )


def _file_response(export: Export, filename: str, export_format: ExportFormat) -> Response:
    """The export serialized in `export_format` as a download named
    `filename`."""
    content: str
    if export_format is ExportFormat.JSON:
        data: dict[str, Any] = render_json(export)
        content = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    else:
        content = render_markdown(export)
    return Response(
        content=content,
        media_type=EXPORT_MEDIA_TYPES[export_format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

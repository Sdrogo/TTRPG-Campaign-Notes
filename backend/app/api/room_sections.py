"""The Room's landing page (spec 55): the Section cards, in order, and the
blocks of a custom Section. Every member reads them; the Master alone edits
them (403 otherwise). A block names its sources (Tags, a map kind, Session 0
features); the items themselves are read from their own endpoints, each with
its own visibility, so the landing never shows what the page behind it
wouldn't. Every write locks the Room and tells its members' streams on commit
(topic `landing`)."""

import uuid
from dataclasses import replace

from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import require_membership
from app.api.errors import http_error, translated_error
from app.api.image_uploads import fetch_url, normalize, read_upload, upload_object
from app.auth.dependencies import CurrentUserDep
from app.db import room_sections_repo, rooms_repo, storage, storage_cleanup, tags_repo
from app.db.session import SessionDep
from app.domain.errors import DomainError
from app.domain.models import RoomRole
from app.domain.room_sections import (
    BlockFieldNotAllowedError,
    BlockInput,
    BlockKind,
    BlockMapKind,
    DocumentsBlockNeedsTagError,
    DocumentsSectionRequiredError,
    InvalidGroupError,
    OnlyMasterEditsLandingError,
    PageSectionExistsError,
    PageSectionHasNoBlocksError,
    Section,
    SectionDescriptionTooLongError,
    SectionKind,
    SectionOrderMismatchError,
    SectionTitleRequiredError,
    SectionTitleTooLongError,
    SessionZeroBlockNeedsFeatureError,
    SessionZeroFeature,
    TooManyBlocksError,
    TooManyGroupsError,
    TooManySectionsError,
    UnknownBlockTagError,
    clean_description,
    clean_title,
    ensure_can_delete,
    ensure_can_edit,
    plan_blocks,
    plan_new_section,
    plan_order,
    plan_section_image_path,
)
from app.i18n.dependencies import LocaleDep
from app.realtime.audience import push
from app.realtime.broker import LANDING, Event

router = APIRouter(prefix="/rooms/{room_id}/sections", tags=["landing"])

_STATUS: dict[type[DomainError], int] = {
    OnlyMasterEditsLandingError: status.HTTP_403_FORBIDDEN,
    PageSectionExistsError: status.HTTP_409_CONFLICT,
    DocumentsSectionRequiredError: status.HTTP_409_CONFLICT,
    PageSectionHasNoBlocksError: status.HTTP_409_CONFLICT,
    SectionTitleRequiredError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    SectionTitleTooLongError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    SectionDescriptionTooLongError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    TooManySectionsError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    SectionOrderMismatchError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    TooManyBlocksError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    DocumentsBlockNeedsTagError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    SessionZeroBlockNeedsFeatureError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    BlockFieldNotAllowedError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    UnknownBlockTagError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    TooManyGroupsError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    InvalidGroupError: status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def _domain_error(exc: DomainError, locale: str) -> HTTPException:
    """The HTTP error for a landing rule broken."""
    return translated_error(_STATUS[type(exc)], exc, locale)


class BlockResponse(BaseModel):
    """A block of a custom Section: what it lists, never the items."""

    id: uuid.UUID
    kind: BlockKind
    position: int
    heading: str | None
    tag_ids: list[uuid.UUID]
    groups: list[list[uuid.UUID]]
    map_kind: BlockMapKind | None
    features: list[SessionZeroFeature]


class SectionResponse(BaseModel):
    """A card of the landing page. `title` is null on a page card the Master
    hasn't named (the client shows its default name); `image_url` a signed
    link, null without an image. `can_edit` for the Master."""

    id: uuid.UUID
    kind: SectionKind
    position: int
    title: str | None
    description: str
    image_url: str | None
    blocks: list[BlockResponse]
    can_edit: bool


class NewSectionBody(BaseModel):
    """A Section to add last: a custom one with its title, or a page card
    back on the landing."""

    kind: SectionKind = SectionKind.CUSTOM
    title: str | None = None


class SectionBody(BaseModel):
    """A Section's new title and description (each optional)."""

    title: str | None = None
    description: str | None = None


class OrderBody(BaseModel):
    """Every Section of the Room, in the new order."""

    ids: list[uuid.UUID]


class BlockBody(BaseModel):
    """A block as the editor sends it."""

    kind: BlockKind
    heading: str | None = Field(default=None, max_length=500)
    tag_ids: list[uuid.UUID] = []
    groups: list[list[uuid.UUID]] = []
    map_kind: BlockMapKind | None = None
    features: list[SessionZeroFeature] = []


class BlocksBody(BaseModel):
    """The Section's whole list of blocks, in order (spec 55 Decision 11)."""

    blocks: list[BlockBody]


class SectionImageFromUrlRequest(BaseModel):
    """A Section image to import from a URL instead of uploading a file."""

    url: HttpUrl


async def _responses(sections: list[Section], can_edit: bool) -> list[SectionResponse]:
    """The Sections with their images signed in one call."""
    urls = await storage.signed_urls([s.image_path for s in sections if s.image_path])
    return [
        SectionResponse(
            id=section.id,
            kind=section.kind,
            position=section.position,
            title=section.title,
            description=section.description,
            image_url=urls.get(section.image_path) if section.image_path else None,
            blocks=[
                BlockResponse(
                    id=block.id,
                    kind=block.kind,
                    position=block.position,
                    heading=block.heading,
                    # Sorted, as the rows read back, so a save and a read agree.
                    tag_ids=sorted(block.tag_ids),
                    groups=[sorted(group) for group in block.groups],
                    map_kind=block.map_kind,
                    features=list(block.features),
                )
                for block in section.blocks
            ],
            can_edit=can_edit,
        )
        for section in sections
    ]


async def _response(section: Section) -> SectionResponse:
    """One Section as the Master gets it back from a write."""
    return (await _responses([section], can_edit=True))[0]


async def _begin_write(
    session: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID, locale: str
) -> None:
    """403 unless the caller is the Room's Master, then the Room locked, so
    two edits of the landing never interleave (positions, the limits)."""
    membership = await require_membership(session, room_id, user_id, locale)
    try:
        ensure_can_edit(membership.role)
    except OnlyMasterEditsLandingError as exc:
        raise _domain_error(exc, locale) from exc
    await rooms_repo.lock_room(session, room_id)


async def _section_or_404(
    session: AsyncSession, room_id: uuid.UUID, section_id: uuid.UUID, locale: str
) -> Section:
    """The Room's Section with its blocks, or 404."""
    section = await room_sections_repo.get_section(session, room_id, section_id)
    if section is None:
        raise http_error(status.HTTP_404_NOT_FOUND, "errors.landing.notFound", locale)
    return section


def _changed(session: AsyncSession, room_id: uuid.UUID, section_id: uuid.UUID | None) -> None:
    """Tells every member's stream the landing changed, once committed."""
    push(session, room_id, Event(None, "changed", section_id, LANDING))


@router.get("")
async def list_sections(
    room_id: uuid.UUID, current_user: CurrentUserDep, session: SessionDep, locale: LocaleDep
) -> list[SectionResponse]:
    """The landing page: every Section in order, with its blocks (403 for a
    non-member). Every member sees every Section (spec 55 Q5)."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    sections = await room_sections_repo.list_sections_with_blocks(session, room_id)
    return await _responses(sections, can_edit=membership.role is RoomRole.MASTER)


@router.get("/{section_id}")
async def get_section(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """One Section with its blocks; 404 for one that isn't this Room's."""
    membership = await require_membership(session, room_id, uuid.UUID(current_user.id), locale)
    section = await _section_or_404(session, room_id, section_id, locale)
    return (await _responses([section], can_edit=membership.role is RoomRole.MASTER))[0]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_section(
    room_id: uuid.UUID,
    body: NewSectionBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """Adds a Section last: a custom one (its title required), or a page card
    the Master deleted (409 when it is there already). 422 past the limit."""
    await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    existing = await room_sections_repo.list_sections(session, room_id)
    try:
        section = plan_new_section(room_id, existing, body.kind, body.title)
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await room_sections_repo.insert_sections(session, [section])
    _changed(session, room_id, section.id)
    return await _response(section)


@router.put("/order")
async def reorder_sections(
    room_id: uuid.UUID,
    body: OrderBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> list[SectionResponse]:
    """Moves the cards: `ids` names every Section of the Room once (422
    otherwise)."""
    await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    existing = await room_sections_repo.list_sections(session, room_id)
    try:
        positions = plan_order(existing, body.ids)
    except SectionOrderMismatchError as exc:
        raise _domain_error(exc, locale) from exc
    await room_sections_repo.set_positions(session, positions)
    _changed(session, room_id, None)
    sections = await room_sections_repo.list_sections_with_blocks(session, room_id)
    return await _responses(
        sorted(sections, key=lambda s: positions[s.id]),
        can_edit=True,
    )


@router.patch("/{section_id}")
async def update_section(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    body: SectionBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """Renames the Section or changes its description. A page card's blank
    title goes back to its default name; a custom one needs a title (422)."""
    await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    section = await _section_or_404(session, room_id, section_id, locale)
    try:
        title = clean_title(body.title, section.kind) if body.title is not None else section.title
        description = (
            clean_description(body.description)
            if body.description is not None
            else section.description
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    section = replace(section, title=title, description=description)
    await room_sections_repo.update_section(session, section)
    _changed(session, room_id, section.id)
    return await _response(section)


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_section(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> None:
    """Deletes a Section, its blocks and its image. The Documents page card
    stays (409). The Documents and maps it listed are untouched."""
    await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    section = await _section_or_404(session, room_id, section_id, locale)
    try:
        ensure_can_delete(section)
    except DocumentsSectionRequiredError as exc:
        raise _domain_error(exc, locale) from exc
    await room_sections_repo.delete_section(session, section.id)
    if section.image_path is not None:
        await storage_cleanup.schedule_removal(session, [section.image_path])
    _changed(session, room_id, section.id)


@router.put("/{section_id}/blocks")
async def replace_blocks(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    body: BlocksBody,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """The Section's blocks become `blocks`, in order (spec 55 Decisions
    11-15): the editor saves the whole list at once. 409 on a page card;
    422 for a block that breaks a rule or names a Tag of another Room."""
    await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    section = await _section_or_404(session, room_id, section_id, locale)
    room_tags = {tag.id for tag in await tags_repo.list_tags(session, room_id)}
    try:
        blocks = plan_blocks(
            section,
            [
                BlockInput(
                    kind=block.kind,
                    heading=block.heading,
                    tag_ids=block.tag_ids,
                    groups=block.groups,
                    map_kind=block.map_kind,
                    features=block.features,
                )
                for block in body.blocks
            ],
            room_tags,
        )
    except DomainError as exc:
        raise _domain_error(exc, locale) from exc
    await room_sections_repo.replace_blocks(session, section.id, blocks)
    _changed(session, room_id, section.id)
    return await _response(replace(section, blocks=blocks))


async def _replace_image(
    session: AsyncSession, room_id: uuid.UUID, section: Section, new_path: str | None
) -> SectionResponse:
    """Points the Section at `new_path` (None removes the image) and settles
    Storage in the same transaction, as the Room image does."""
    await room_sections_repo.set_section_image(session, section.id, new_path)
    if new_path is not None:
        await storage_cleanup.confirm_upload(session, new_path)
    if section.image_path is not None:
        await storage_cleanup.schedule_removal(session, [section.image_path])
    _changed(session, room_id, section.id)
    return await _response(replace(section, image_path=new_path))


async def _store_image(
    session: AsyncSession, room_id: uuid.UUID, section_id: uuid.UUID, data: bytes, locale: str
) -> SectionResponse:
    """Validates and re-encodes the image (not cropped, like the Room
    image), uploads it and swaps it in. Call after `_require_master`."""
    normalized = await normalize(data, locale)
    await rooms_repo.lock_room(session, room_id)
    section = await _section_or_404(session, room_id, section_id, locale)
    path = plan_section_image_path(room_id)
    await upload_object(path, normalized, locale)
    return await _replace_image(session, room_id, section, path)


async def _require_master(
    session: AsyncSession,
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    user_id: uuid.UUID,
    locale: str,
) -> None:
    """403 unless the Master, 404 for a Section of another Room, before the
    file is read, so a refused upload costs nothing."""
    membership = await require_membership(session, room_id, user_id, locale)
    try:
        ensure_can_edit(membership.role)
    except OnlyMasterEditsLandingError as exc:
        raise _domain_error(exc, locale) from exc
    await _section_or_404(session, room_id, section_id, locale)


@router.post("/{section_id}/image")
async def upload_section_image(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """Replaces the Section card's image with an uploaded one (WebP, at
    most 1920 px). 413 for a file over the limits, 422 for one that isn't a
    supported image."""
    await _require_master(session, room_id, section_id, uuid.UUID(current_user.id), locale)
    data = await read_upload(file)
    return await _store_image(session, room_id, section_id, data, locale)


@router.post("/{section_id}/image/from-url")
async def import_section_image(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    body: SectionImageFromUrlRequest,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """Replaces the Section card's image with one fetched from a URL (422
    for a URL that can't be fetched safely)."""
    await _require_master(session, room_id, section_id, uuid.UUID(current_user.id), locale)
    data = await fetch_url(str(body.url), locale)
    return await _store_image(session, room_id, section_id, data, locale)


@router.delete("/{section_id}/image")
async def remove_section_image(
    room_id: uuid.UUID,
    section_id: uuid.UUID,
    current_user: CurrentUserDep,
    session: SessionDep,
    locale: LocaleDep,
) -> SectionResponse:
    """Removes the Section card's image."""
    await _begin_write(session, room_id, uuid.UUID(current_user.id), locale)
    section = await _section_or_404(session, room_id, section_id, locale)
    return await _replace_image(session, room_id, section, None)

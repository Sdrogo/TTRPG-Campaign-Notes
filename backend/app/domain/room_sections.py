"""The Room's landing page (spec 55): its Sections and their blocks. Pure: the
rules for what a Section and a block may hold, who edits them, the three
page cards every Room starts with, and what a Tag's deletion leaves of the
blocks. The items a block shows are not resolved here: each one keeps its
own visibility and the client reads them from their own endpoints."""

import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.images import OUTPUT_EXTENSION
from app.domain.models import RoomRole
from app.domain.rooms import ROOM_IMAGE_PATH_PREFIX

MAX_SECTIONS = 30
MAX_BLOCKS = 10
MAX_GROUPS = 20
MAX_TITLE_LENGTH = 100
MAX_DESCRIPTION_LENGTH = 2000


class SectionKind(StrEnum):
    """A custom Section (a page of blocks), or a page card that opens one of
    the Room's existing pages (spec 55 Decision 5)."""

    CUSTOM = "custom"
    PAGE_DOCUMENTS = "page_documents"
    PAGE_MAPS = "page_maps"
    PAGE_SESSION_ZERO = "page_session_zero"


# The page cards every Room starts with, in their default order.
PAGE_KINDS = (SectionKind.PAGE_DOCUMENTS, SectionKind.PAGE_MAPS, SectionKind.PAGE_SESSION_ZERO)


class BlockKind(StrEnum):
    """What a block of a custom Section lists (spec 55, Terms)."""

    DOCUMENTS = "documents"
    MAPS = "maps"
    SESSION_ZERO = "session_zero"


class BlockMapKind(StrEnum):
    """The maps a maps block keeps, as the Maps page lists them (relationship
    or geographic; a Document's mention map lives on its Document, spec 36);
    a block with none keeps them all."""

    FREE = "free"
    GEOGRAPHIC = "geographic"


class SessionZeroFeature(StrEnum):
    """What a Session 0 block shows: the sessions, or the steps of one kind
    (spec 47), Lines & Veils being the Room's one board."""

    SESSIONS = "sessions"
    RETRO = "retro"
    LINES_VEILS = "lines_veils"
    STARS_WISHES = "stars_wishes"
    QUESTIONS = "questions"
    DDI = "ddi"
    POLLS = "polls"


class OnlyMasterEditsLandingError(DomainError):
    """Only the Master edits the landing page (spec 55 Decision 1, D-08)."""


class SectionTitleRequiredError(DomainError):
    """A custom Section needs a title."""


class SectionTitleTooLongError(DomainError):
    """A Section's title is at most `MAX_TITLE_LENGTH` characters."""


class SectionDescriptionTooLongError(DomainError):
    """A Section's description is at most `MAX_DESCRIPTION_LENGTH` characters."""


class TooManySectionsError(DomainError):
    """A Room holds at most `MAX_SECTIONS` Sections (spec 55 Decision 14)."""


class PageSectionExistsError(DomainError):
    """A page card is on the landing at most once."""


class DocumentsSectionRequiredError(DomainError):
    """The Documents page card can't be deleted (spec 55 Decision 5): it is
    the way to the full list."""


class PageSectionHasNoBlocksError(DomainError):
    """A page card opens an existing page; it has no blocks."""


class SectionOrderMismatchError(DomainError):
    """A new order must name every Section of the Room exactly once."""


class TooManyBlocksError(DomainError):
    """A Section holds at most `MAX_BLOCKS` blocks."""


class DocumentsBlockNeedsTagError(DomainError):
    """A Documents block lists the Documents with all its Tags: it needs at
    least one (spec 55 Decision 14)."""


class SessionZeroBlockNeedsFeatureError(DomainError):
    """A Session 0 block shows at least one feature."""


class BlockFieldNotAllowedError(DomainError):
    """A block carries only its own kind's settings: Tags and groups on a
    Documents block, a map kind on a maps block, features on a Session 0
    block."""


class UnknownBlockTagError(DomainError):
    """A block or group names a Tag that isn't in this Room."""


class TooManyGroupsError(DomainError):
    """A Documents block holds at most `MAX_GROUPS` groups."""


class InvalidGroupError(DomainError):
    """A group is one Tag or a combination of distinct Tags, never empty and
    never the same as another group of its block."""


@dataclass(frozen=True)
class Block:
    """A block of a custom Section, in its place. `tag_ids` and `groups`
    (each a set of Tag ids, in order) belong to a Documents block,
    `map_kind` to a maps block, `features` (in the Master's order) to a
    Session 0 block."""

    id: uuid.UUID
    kind: BlockKind
    position: int
    heading: str | None = None
    tag_ids: tuple[uuid.UUID, ...] = ()
    groups: tuple[tuple[uuid.UUID, ...], ...] = ()
    map_kind: BlockMapKind | None = None
    features: tuple[SessionZeroFeature, ...] = ()


@dataclass(frozen=True)
class Section:
    """A card of the landing page, in its place. A page card's `title` is
    None until the Master names it, so each viewer reads its default name
    in their own language."""

    id: uuid.UUID
    room_id: uuid.UUID
    kind: SectionKind
    position: int
    title: str | None
    description: str = ""
    image_path: str | None = None
    blocks: tuple[Block, ...] = field(default=())


@dataclass(frozen=True)
class BlockInput:
    """A block as the editor sends it (the whole list is replaced at once)."""

    kind: BlockKind
    heading: str | None = None
    tag_ids: Sequence[uuid.UUID] = ()
    groups: Sequence[Sequence[uuid.UUID]] = ()
    map_kind: BlockMapKind | None = None
    features: Sequence[SessionZeroFeature] = ()


def ensure_can_edit(role: RoomRole) -> None:
    """Spec 55 Decision 1: the Master alone edits the landing (403). An
    Administrator who isn't a Master sees it like a Player."""
    if role is not RoomRole.MASTER:
        raise OnlyMasterEditsLandingError("errors.landing.onlyMaster")


def default_sections(room_id: uuid.UUID) -> tuple[Section, ...]:
    """The three page cards a new Room starts with (spec 55 Decision 5):
    Documents, Maps, Session 0, untitled."""
    return tuple(
        Section(id=uuid.uuid4(), room_id=room_id, kind=kind, position=position, title=None)
        for position, kind in enumerate(PAGE_KINDS)
    )


def clean_title(title: str | None, kind: SectionKind) -> str | None:
    """`title` trimmed and checked (422): required on a custom Section, at
    most `MAX_TITLE_LENGTH` characters. A page card's blank title goes back
    to its default name (None)."""
    clean = (title or "").strip()
    if not clean:
        if kind is SectionKind.CUSTOM:
            raise SectionTitleRequiredError("errors.landing.titleRequired")
        return None
    if len(clean) > MAX_TITLE_LENGTH:
        raise SectionTitleTooLongError("errors.landing.titleTooLong", max=MAX_TITLE_LENGTH)
    return clean


def clean_description(description: str) -> str:
    """`description` trimmed, at most `MAX_DESCRIPTION_LENGTH` characters (422)."""
    clean = description.strip()
    if len(clean) > MAX_DESCRIPTION_LENGTH:
        raise SectionDescriptionTooLongError(
            "errors.landing.descriptionTooLong", max=MAX_DESCRIPTION_LENGTH
        )
    return clean


def plan_new_section(
    room_id: uuid.UUID,
    existing: Collection[Section],
    kind: SectionKind,
    title: str | None,
) -> Section:
    """A Section added last: a custom one with its title (422 without), or a
    page card the Master deleted and adds back (409 when it is already
    there). 422 past `MAX_SECTIONS`."""
    if len(existing) >= MAX_SECTIONS:
        raise TooManySectionsError("errors.landing.tooManySections", max=MAX_SECTIONS)
    if kind is not SectionKind.CUSTOM and any(s.kind is kind for s in existing):
        raise PageSectionExistsError("errors.landing.pageSectionExists")
    return Section(
        id=uuid.uuid4(),
        room_id=room_id,
        kind=kind,
        position=max((s.position for s in existing), default=-1) + 1,
        title=clean_title(title, kind),
    )


def ensure_can_delete(section: Section) -> None:
    """409 for the Documents page card (spec 55 Decision 5)."""
    if section.kind is SectionKind.PAGE_DOCUMENTS:
        raise DocumentsSectionRequiredError("errors.landing.documentsRequired")


def plan_order(existing: Collection[Section], ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Each Section's new position: `ids` must name every Section of the
    Room exactly once (422 otherwise)."""
    if len(ids) != len(set(ids)) or set(ids) != {s.id for s in existing}:
        raise SectionOrderMismatchError("errors.landing.orderMismatch")
    return {section_id: position for position, section_id in enumerate(ids)}


def _clean_heading(heading: str | None) -> str | None:
    """A block's heading trimmed; blank means "named after its source"."""
    clean = (heading or "").strip()
    if len(clean) > MAX_TITLE_LENGTH:
        raise SectionTitleTooLongError("errors.landing.titleTooLong", max=MAX_TITLE_LENGTH)
    return clean or None


def _unique(ids: Iterable[uuid.UUID]) -> tuple[uuid.UUID, ...]:
    """`ids` without repeats, in their first order."""
    return tuple(dict.fromkeys(ids))


def _plan_groups(
    groups: Sequence[Sequence[uuid.UUID]], room_tags: Collection[uuid.UUID]
) -> tuple[tuple[uuid.UUID, ...], ...]:
    """A Documents block's groups, in order: each one Tag or a combination of
    distinct Tags of the Room, none empty or repeated (422)."""
    if len(groups) > MAX_GROUPS:
        raise TooManyGroupsError("errors.landing.tooManyGroups", max=MAX_GROUPS)
    planned: list[tuple[uuid.UUID, ...]] = []
    seen: set[frozenset[uuid.UUID]] = set()
    for group in groups:
        tag_ids = _unique(group)
        if not tag_ids or frozenset(tag_ids) in seen:
            raise InvalidGroupError("errors.landing.invalidGroup")
        if not set(tag_ids) <= set(room_tags):
            raise UnknownBlockTagError("errors.landing.unknownTag")
        seen.add(frozenset(tag_ids))
        planned.append(tag_ids)
    return tuple(planned)


def plan_blocks(
    section: Section, blocks: Sequence[BlockInput], room_tags: Collection[uuid.UUID]
) -> tuple[Block, ...]:
    """The Section's new blocks, replacing the old ones, in order (spec 55
    Decisions 13-15). 409 on a page card; 422 past `MAX_BLOCKS`, for a
    Documents block without Tags, a Session 0 block without features, a
    setting another kind's block carries, or a Tag that isn't the Room's.
    Repeated Tags and features are dropped."""
    if section.kind is not SectionKind.CUSTOM:
        raise PageSectionHasNoBlocksError("errors.landing.pageSectionHasNoBlocks")
    if len(blocks) > MAX_BLOCKS:
        raise TooManyBlocksError("errors.landing.tooManyBlocks", max=MAX_BLOCKS)
    planned: list[Block] = []
    for position, block in enumerate(blocks):
        documents = block.kind is BlockKind.DOCUMENTS
        if (
            (not documents and (block.tag_ids or block.groups))
            or (block.kind is not BlockKind.MAPS and block.map_kind is not None)
            or (block.kind is not BlockKind.SESSION_ZERO and block.features)
        ):
            raise BlockFieldNotAllowedError("errors.landing.blockFieldNotAllowed")
        tag_ids = _unique(block.tag_ids)
        if documents and not tag_ids:
            raise DocumentsBlockNeedsTagError("errors.landing.documentsBlockNeedsTag")
        if not set(tag_ids) <= set(room_tags):
            raise UnknownBlockTagError("errors.landing.unknownTag")
        features = tuple(dict.fromkeys(block.features))
        if block.kind is BlockKind.SESSION_ZERO and not features:
            raise SessionZeroBlockNeedsFeatureError("errors.landing.sessionZeroBlockNeedsFeature")
        planned.append(
            Block(
                id=uuid.uuid4(),
                kind=block.kind,
                position=position,
                heading=_clean_heading(block.heading),
                tag_ids=tag_ids,
                groups=_plan_groups(block.groups, room_tags),
                map_kind=block.map_kind,
                features=features,
            )
        )
    return tuple(planned)


def prune_after_tag_deletion(block: Block, tag_id: uuid.UUID) -> Block | None:
    """What a Tag's deletion leaves of `block` (spec 55 Decision 17): the Tag
    out of its filter and groups, a group left empty dropped and one now
    equal to an earlier group merged into it. None when a Documents block
    is left without Tags: it is deleted."""
    if block.kind is not BlockKind.DOCUMENTS:
        return block
    tag_ids = tuple(t for t in block.tag_ids if t != tag_id)
    if not tag_ids:
        return None
    groups: list[tuple[uuid.UUID, ...]] = []
    seen: set[frozenset[uuid.UUID]] = set()
    for group in block.groups:
        left = tuple(t for t in group if t != tag_id)
        if left and frozenset(left) not in seen:
            seen.add(frozenset(left))
            groups.append(left)
    return replace(block, tag_ids=tag_ids, groups=tuple(groups))


def copy_sections(
    sections: Iterable[Section], room_id: uuid.UUID, tags: Mapping[uuid.UUID, uuid.UUID]
) -> tuple[Section, ...]:
    """The landing page of a duplicated Room (spec 55 Decision 5, spec 33):
    every Section and block with fresh ids, Tags re-pointed to their copies.
    An image keeps naming the same Storage object, like a Document image's
    copy (spec 33 Decision 10)."""
    return tuple(
        replace(
            section,
            id=uuid.uuid4(),
            room_id=room_id,
            blocks=tuple(
                replace(
                    block,
                    id=uuid.uuid4(),
                    tag_ids=tuple(tags[t] for t in block.tag_ids),
                    groups=tuple(tuple(tags[t] for t in group) for group in block.groups),
                )
                for block in section.blocks
            ),
        )
        for section in sections
    )


def plan_section_image_path(room_id: uuid.UUID) -> str:
    """A fresh random name per upload under the Room's folder, like the Room
    image (spec 26), so a replaced image never serves a stale cached copy."""
    return f"{ROOM_IMAGE_PATH_PREFIX}/{room_id}/sections/{uuid.uuid4()}{OUTPUT_EXTENSION}"

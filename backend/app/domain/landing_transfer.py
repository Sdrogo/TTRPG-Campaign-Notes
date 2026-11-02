"""The landing page in the Room export and the import (spec 56): a Section as
the JSON export writes it (`section_to_json`), read back from a file
(`read_section`) and planned into the target Room (`plan_section`).

Pure: no database, no network. What a file says about a Section goes through
the rules of an edit (`plan_new_section`, `plan_blocks`): a Section that
doesn't pass is skipped whole, never written in part. Its ids only link
objects inside the file: a block's Tags point into the file's `tags`, matched
by name like a Document's."""

import uuid
from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any

from app.domain.errors import DomainError
from app.domain.room_sections import (
    Block,
    BlockInput,
    BlockKind,
    BlockMapKind,
    Section,
    SectionKind,
    SessionZeroFeature,
    TooManySectionsError,
    clean_description,
    clean_title,
    plan_blocks,
    plan_new_section,
)

# A file can't hold more: a Room has at most 30 Sections, and an import reads
# at most 10 files.
MAX_SECTIONS_PER_IMPORT = 100


class UnreadableSectionError(DomainError):
    """A Section of the file whose fields aren't what the export writes: it
    is skipped as `invalid`."""


class SectionSkipReason(StrEnum):
    """Why a Section of the file is not written: it breaks a rule of an edit
    (`invalid`), or the landing has no room for it (`limit`)."""

    INVALID = "invalid"
    LIMIT = "limit"


# --- Export --------------------------------------------------------------------


def section_to_json(section: Section, image_url: str | None) -> dict[str, Any]:
    """A Section of the JSON export (spec 56 Decision 3): its fields, its
    image as a signed link, and its blocks in order, Tags by id."""
    return {
        "id": str(section.id),
        "kind": section.kind.value,
        "title": section.title,
        "description": section.description,
        "image_url": image_url,
        "blocks": [
            {
                "kind": block.kind.value,
                "heading": block.heading,
                "tag_ids": [str(tag_id) for tag_id in block.tag_ids],
                "groups": [[str(tag_id) for tag_id in group] for group in block.groups],
                "map_kind": None if block.map_kind is None else block.map_kind.value,
                "features": [feature.value for feature in block.features],
            }
            for block in section.blocks
        ],
    }


# --- Reading a Section of a file ----------------------------------------------------


@dataclass(frozen=True)
class FileBlock:
    """A block as the file holds it, its Tags still the file's ids."""

    kind: BlockKind
    heading: str | None
    tag_ids: tuple[str, ...]
    groups: tuple[tuple[str, ...], ...]
    map_kind: BlockMapKind | None
    features: tuple[SessionZeroFeature, ...]


@dataclass(frozen=True)
class FileSection:
    """A Section as the file holds it."""

    kind: SectionKind
    title: str | None
    description: str
    image_url: str | None
    blocks: tuple[FileBlock, ...]


def _unreadable() -> UnreadableSectionError:
    return UnreadableSectionError("errors.landing.blockFieldNotAllowed")


def _object(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _unreadable()
    return value


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise _unreadable()
    return value


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise _unreadable()
    return value


def _strings(value: Any) -> tuple[str, ...]:
    """A list of strings (Tag ids of the file)."""
    items = _list(value)
    if not all(isinstance(item, str) for item in items):
        raise _unreadable()
    return tuple(items)


def _choice[E: StrEnum](kind: type[E], value: Any) -> E:
    try:
        return kind(value)
    except ValueError as exc:
        raise _unreadable() from exc


def read_section(raw: Any) -> FileSection:
    """A Section object of the file (spec 56 Decision 3) as `FileSection`.
    `UnreadableSectionError` when a field has the wrong type or value; extra
    fields are ignored."""
    data = _object(raw)
    blocks = tuple(
        FileBlock(
            kind=_choice(BlockKind, block.get("kind")),
            heading=_opt_str(block.get("heading")),
            tag_ids=_strings(block.get("tag_ids")),
            groups=tuple(_strings(group) for group in _list(block.get("groups"))),
            map_kind=None
            if block.get("map_kind") is None
            else _choice(BlockMapKind, block.get("map_kind")),
            features=tuple(
                _choice(SessionZeroFeature, feature) for feature in _list(block.get("features"))
            ),
        )
        for block in map(_object, _list(data.get("blocks")))
    )
    return FileSection(
        kind=_choice(SectionKind, data.get("kind", SectionKind.CUSTOM.value)),
        title=_opt_str(data.get("title")),
        description=_opt_str(data.get("description")) or "",
        image_url=_opt_str(data.get("image_url")),
        blocks=blocks,
    )


def section_title(raw: dict[str, Any]) -> str | None:
    """The title a Section of the file shows in the preview, even when it
    can't be read."""
    title = raw.get("title")
    return (title.strip() or None) if isinstance(title, str) else None


def section_kind(raw: dict[str, Any]) -> SectionKind:
    """The kind a Section of the file shows in the preview, custom when it
    can't be read."""
    kind: Any = raw.get("kind", SectionKind.CUSTOM.value)
    try:
        return SectionKind(kind)
    except ValueError:
        return SectionKind.CUSTOM


def has_content(section: FileSection) -> bool:
    """Whether a page card of the file carries something the Master set (a
    title, a description, an image): only then is it offered (Decision 6)."""
    return bool((section.title or "").strip() or section.description.strip() or section.image_url)


# --- Planning a Section of the file ----------------------------------------------


@dataclass(frozen=True)
class PlannedSection:
    """A Section of the file and what becomes of it: a new custom Section
    under `id`, a page card applied to the Room's own (`kind` not custom), or
    `skipped` and why. `skipped_blocks` counts the Documents blocks left
    without any Tag the import can resolve (Decision 7)."""

    key: str
    file_name: str
    id: uuid.UUID
    kind: SectionKind
    title: str | None
    description: str
    image_url: str | None
    blocks: tuple[Block, ...]
    skipped_blocks: int = 0
    skipped: SectionSkipReason | None = None

    @property
    def is_page_card(self) -> bool:
        """A page card of the file, applied to the Room's own."""
        return self.kind is not SectionKind.CUSTOM


def section_key(file_index: int, section_index: int) -> str:
    """The key a client uses for a Section of an upload, like `map_key`."""
    return f"{file_index}:section:{section_index}"


def skipped_section(
    key: str, file_name: str, kind: SectionKind, title: str | None, reason: SectionSkipReason
) -> PlannedSection:
    """A Section of the file that is not written."""
    return PlannedSection(
        key=key,
        file_name=file_name,
        id=uuid.uuid4(),
        kind=kind,
        title=title,
        description="",
        image_url=None,
        blocks=(),
        skipped=reason,
    )


def _resolved(
    ids: Sequence[str], resolve: Callable[[str], uuid.UUID | None]
) -> tuple[uuid.UUID, ...]:
    """The Room's Tags for the file's Tag ids, in order, the unresolved ones
    dropped."""
    found = (resolve(tag_id) for tag_id in ids)
    return tuple(dict.fromkeys(tag_id for tag_id in found if tag_id is not None))


def _block_inputs(
    blocks: Sequence[FileBlock], resolve: Callable[[str], uuid.UUID | None]
) -> tuple[list[BlockInput], set[uuid.UUID], int]:
    """The file's blocks as an edit would send them, with the Room's Tags:
    a Tag that can't be resolved leaves the block and its groups, a group
    left empty or now equal to an earlier one goes, and a Documents block
    left with no Tag is skipped (counted). Also returns every Tag used."""
    inputs: list[BlockInput] = []
    used: set[uuid.UUID] = set()
    skipped = 0
    for block in blocks:
        tag_ids = _resolved(block.tag_ids, resolve)
        groups: list[tuple[uuid.UUID, ...]] = []
        seen: set[frozenset[uuid.UUID]] = set()
        for group in block.groups:
            resolved = _resolved(group, resolve)
            if resolved and frozenset(resolved) not in seen:
                seen.add(frozenset(resolved))
                groups.append(resolved)
        if block.kind is BlockKind.DOCUMENTS and not tag_ids:
            skipped += 1
            continue
        used.update(tag_ids, *groups)
        inputs.append(
            BlockInput(
                kind=block.kind,
                heading=block.heading,
                tag_ids=tag_ids,
                groups=groups,
                map_kind=block.map_kind,
                features=block.features,
            )
        )
    return inputs, used, skipped


def plan_section(
    file_section: FileSection,
    key: str,
    file_name: str,
    room_id: uuid.UUID,
    existing: Collection[Section],
    resolve: Callable[[str], uuid.UUID | None],
) -> PlannedSection:
    """What `file_section` becomes in the Room (spec 56 Decisions 5 to 8)
    whose landing holds `existing` (the Sections planned before it
    included). A custom Section is added last with its blocks; a page card
    takes the Room's card of its kind (its blocks, which a page card never
    has, ignored), or is added back when the Room deleted it. `resolve`
    gives the Room's Tag for a Tag id of the file. A Section that breaks a
    rule is skipped as `invalid`, one past the cap as `limit`."""
    title = (file_section.title or "").strip() or None
    planned = PlannedSection(
        key=key,
        file_name=file_name,
        id=uuid.uuid4(),
        kind=file_section.kind,
        title=title,
        description="",
        image_url=file_section.image_url,
        blocks=(),
    )
    try:
        title = clean_title(file_section.title, file_section.kind)
        description = clean_description(file_section.description)
        if file_section.kind is not SectionKind.CUSTOM:
            own = next((s for s in existing if s.kind is file_section.kind), None)
            if own is None:
                own = plan_new_section(room_id, existing, file_section.kind, None)
            return replace(planned, id=own.id, title=title, description=description)
        section = plan_new_section(room_id, existing, SectionKind.CUSTOM, title)
        inputs, used, skipped_blocks = _block_inputs(file_section.blocks, resolve)
        blocks = plan_blocks(section, inputs, used)
    except TooManySectionsError:
        return replace(planned, image_url=None, skipped=SectionSkipReason.LIMIT)
    except DomainError:
        return replace(planned, image_url=None, skipped=SectionSkipReason.INVALID)
    return replace(
        planned,
        id=section.id,
        title=title,
        description=description,
        blocks=blocks,
        skipped_blocks=skipped_blocks,
    )


def to_section(planned: PlannedSection, room_id: uuid.UUID, position: int) -> Section:
    """A planned Section as the row the job inserts, at `position`, with no
    image yet (the job stores it after the commit)."""
    return Section(
        id=planned.id,
        room_id=room_id,
        kind=planned.kind,
        position=position,
        title=planned.title,
        description=planned.description,
        blocks=planned.blocks,
    )

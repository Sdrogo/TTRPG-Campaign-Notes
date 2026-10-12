"""Duplicating a Room (spec 33): the rules for what a copy holds and who may
make one. Pure: it takes the source Room already read and returns the rows to
write, so every rule is testable without a database. A copy is a new Room with
fresh ids whose only member is the person who made it; it holds the setup, the
Tags and the Documents with their Notes and images, and nothing that belongs
to a person (Comments, Reveals, Owners, the Character player, grants) or to
Storage objects of their own (PDF Attachments)."""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.mentions import (
    MentionKind,
    PlannedMention,
    find_mentions,
    mention_token,
    plan_source_mentions,
    unlink_mentions,
)
from app.domain.models import (
    DocumentVisibility,
    Membership,
    Room,
    RoomRole,
    RoomStatus,
    Tag,
)

# The `rooms.name` column's length: a long name is shortened to fit the suffix.
MAX_ROOM_NAME_LENGTH = 200


class OnlyMasterCanDuplicateError(DomainError):
    """Only the Master duplicates a Room (spec 33 Decision 5): they see every
    Document, so the copy is complete."""


@dataclass(frozen=True)
class SourceNote:
    """A Note of a Document being copied, in its place in the Document."""

    id: uuid.UUID
    title: str
    text: str
    visibility: DocumentVisibility
    position: int


@dataclass(frozen=True)
class SourceImage:
    """A gallery image of a Document being copied (never a Comment's image):
    where its object lives in Storage, whether it leads, and when it was added
    so the copy keeps the gallery's order."""

    storage_path: str
    is_favorite: bool
    created_at: datetime


@dataclass(frozen=True)
class SourceDocument:
    """A Document of the Room being copied, as the Master sees it."""

    id: uuid.UUID
    name: str
    subtitle: str | None
    text: str
    visibility: DocumentVisibility
    tag_ids: tuple[uuid.UUID, ...]
    notes: tuple[SourceNote, ...]
    images: tuple[SourceImage, ...]


@dataclass(frozen=True)
class SourceCombination:
    """A combination of Tags the Room groups Documents by (spec 11_2)."""

    position: int
    tag_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True)
class RoomSource:
    """Everything a copy is made from."""

    room: Room
    tags: tuple[Tag, ...]
    combinations: tuple[SourceCombination, ...]
    documents: tuple[SourceDocument, ...]


@dataclass(frozen=True)
class PlannedCopyImage:
    """A gallery image row of the copy: it names the same Storage object as the
    original (Decision 10), under a new row id."""

    id: uuid.UUID
    storage_path: str
    is_favorite: bool
    created_at: datetime


@dataclass(frozen=True)
class PlannedCopyDocument:
    """A Document of the copy: new ids, the duplicator as its creator and only
    Owner, its mentions pointing inside the copy (Decision 8)."""

    id: uuid.UUID
    name: str
    subtitle: str | None
    text: str
    visibility: DocumentVisibility
    tag_ids: tuple[uuid.UUID, ...]
    notes: tuple[SourceNote, ...]
    images: tuple[PlannedCopyImage, ...]


@dataclass(frozen=True)
class PlannedCombination:
    """A combination of the copy, over the copy's Tags."""

    id: uuid.UUID
    position: int
    tag_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True)
class PlannedBacklink:
    """A backlink row of the copy (spec 20): `note_id` is None for a
    Document's description."""

    document_id: uuid.UUID
    note_id: uuid.UUID | None
    mention: PlannedMention


@dataclass(frozen=True)
class RoomCopyPlan:
    """Everything the copy is created with, written in one transaction."""

    room: Room
    membership: Membership
    tags: tuple[Tag, ...]
    combinations: tuple[PlannedCombination, ...]
    documents: tuple[PlannedCopyDocument, ...]
    backlinks: tuple[PlannedBacklink, ...]


def ensure_can_duplicate(requester: Membership) -> None:
    """Spec 33 Decision 5: only the Master may duplicate a Room (403)."""
    if requester.role != RoomRole.MASTER:
        raise OnlyMasterCanDuplicateError("errors.room.onlyMasterCanDuplicate")


def copy_name(name: str, suffix: str) -> str:
    """The copy's name (Decision 7): `name` then `suffix`, with `name` shortened
    when both would pass the column's length."""
    room = MAX_ROOM_NAME_LENGTH - len(suffix)
    return f"{name[:room].rstrip()}{suffix}"


def remap_mentions(
    text: str,
    documents: Mapping[uuid.UUID, uuid.UUID],
    tags: Mapping[uuid.UUID, uuid.UUID],
) -> str:
    """`text` for the copy (Decision 8): a `#` mention of a Document or Tag of
    the source now names its copy, any other mention (a member, or content
    outside the Room) is plain `@Name` or `#Name`. Only the tokens written here
    stay links, so a name that reads like a token can't smuggle one in."""
    parts: list[str] = []
    allowed: set[tuple[MentionKind, uuid.UUID]] = set()
    last = 0
    for mention in find_mentions(text):
        parts.append(text[last : mention.start])
        last = mention.end
        targets = documents if mention.kind is MentionKind.DOCUMENT else tags
        target = targets.get(mention.target_id) if mention.kind is not MentionKind.USER else None
        if target is None:
            parts.append(("@" if mention.kind is MentionKind.USER else "#") + mention.name)
        else:
            allowed.add((mention.kind, target))
            parts.append(mention_token(mention.kind, target, mention.name))
    parts.append(text[last:])
    return unlink_mentions("".join(parts), lambda m: (m.kind, m.target_id) in allowed)


def _copy_level(level: DocumentVisibility) -> DocumentVisibility:
    """Decision 8: Selective becomes Private, its grant list names members of
    the source Room."""
    return DocumentVisibility.PRIVATE if level is DocumentVisibility.SELECTIVE else level


def plan_room_copy(source: RoomSource, requester: Membership, suffix: str) -> RoomCopyPlan:
    """The copy of `source` made by `requester` (403 unless the Master): the
    Room and its setup (Decision 3), their Membership as Master and
    Administrator (Decision 6), the Tags and combinations over new ids, and the
    Documents with their Notes and images (Decisions 3, 8, 10)."""
    ensure_can_duplicate(requester)
    new_room_id = uuid.uuid4()
    room = replace(
        source.room,
        id=new_room_id,
        name=copy_name(source.room.name, suffix),
        status=RoomStatus.ACTIVE,
        created_by=requester.user_id,
    )
    membership = Membership(
        id=uuid.uuid4(),
        room_id=new_room_id,
        user_id=requester.user_id,
        role=RoomRole.MASTER,
        is_admin=True,
    )
    tag_ids = {tag.id: uuid.uuid4() for tag in source.tags}
    tags = tuple(replace(tag, id=tag_ids[tag.id], room_id=new_room_id) for tag in source.tags)
    combinations = tuple(
        PlannedCombination(
            id=uuid.uuid4(),
            position=combination.position,
            tag_ids=tuple(tag_ids[tag_id] for tag_id in combination.tag_ids),
        )
        for combination in source.combinations
    )
    document_ids = {document.id: uuid.uuid4() for document in source.documents}

    documents: list[PlannedCopyDocument] = []
    backlinks: list[PlannedBacklink] = []
    for document in source.documents:
        copy_id = document_ids[document.id]
        text = remap_mentions(document.text, document_ids, tag_ids)
        notes = tuple(
            replace(
                note,
                id=uuid.uuid4(),
                text=remap_mentions(note.text, document_ids, tag_ids),
                visibility=_copy_level(note.visibility),
            )
            for note in document.notes
        )
        documents.append(
            PlannedCopyDocument(
                id=copy_id,
                name=document.name,
                subtitle=document.subtitle,
                text=text,
                visibility=_copy_level(document.visibility),
                tag_ids=tuple(tag_ids[tag_id] for tag_id in document.tag_ids),
                notes=notes,
                images=tuple(
                    PlannedCopyImage(
                        id=uuid.uuid4(),
                        storage_path=image.storage_path,
                        is_favorite=image.is_favorite,
                        created_at=image.created_at,
                    )
                    for image in document.images
                ),
            )
        )
        backlinks.extend(
            PlannedBacklink(copy_id, None, mention)
            for mention in plan_source_mentions(text, copy_id)
        )
        for note in notes:
            backlinks.extend(
                PlannedBacklink(copy_id, note.id, mention)
                for mention in plan_source_mentions(note.text, copy_id)
            )
    return RoomCopyPlan(
        room=room,
        membership=membership,
        tags=tags,
        combinations=combinations,
        documents=tuple(documents),
        backlinks=tuple(backlinks),
    )

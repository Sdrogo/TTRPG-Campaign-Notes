"""Duplicating a Room (spec 33): the rules for what a copy holds and who may
make one. Pure: it takes the source Room already read and returns the rows to
write, so every rule is testable without a database. A copy is a new Room with
fresh ids whose only member is the person who made it; it holds the setup, the
Tags, the Documents with their Notes and images, and the maps (spec 40), and
nothing that belongs to a person (Comments, Reveals, Owners, the Character
player, grants) or to Storage objects of their own (PDF Attachments)."""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime

from app.domain.errors import DomainError
from app.domain.geographic_maps import Area, GeoBoard, Link, LinkEnd, Pin
from app.domain.mention_maps import mention_card_id
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
from app.domain.relationship_maps import (
    ArrowEnd,
    Board,
    MapArrow,
    MapCard,
    RelationshipMap,
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
    # The row's id, so a map card that chose this image follows its copy.
    id: uuid.UUID | None = None


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
class SourceMap:
    """A map of the Room being copied (spec 40 Decision 1): a free map with its
    `board`, a geographic one with its `geo` content, or a Document's mention
    map (spec 36) with its saved cards on `board`; `linked_document_ids` are
    the Documents that show it on their page."""

    map: RelationshipMap
    board: Board = Board()
    geo: GeoBoard = GeoBoard()
    linked_document_ids: tuple[uuid.UUID, ...] = ()


@dataclass(frozen=True)
class RoomSource:
    """Everything a copy is made from."""

    room: Room
    tags: tuple[Tag, ...]
    combinations: tuple[SourceCombination, ...]
    documents: tuple[SourceDocument, ...]
    maps: tuple[SourceMap, ...] = ()


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
    """Everything the copy is created with, written in one transaction. Its
    `maps` are `SourceMap`s already re-pointed into the copy."""

    room: Room
    membership: Membership
    tags: tuple[Tag, ...]
    combinations: tuple[PlannedCombination, ...]
    documents: tuple[PlannedCopyDocument, ...]
    backlinks: tuple[PlannedBacklink, ...]
    maps: tuple[SourceMap, ...] = ()


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
    Administrator (Decision 6), the Tags and combinations over new ids, the
    Documents with their Notes and images (Decisions 3, 8, 10), and every map
    (spec 40, `copy_map`)."""
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
    image_ids = {
        image.id: uuid.uuid4()
        for document in source.documents
        for image in document.images
        if image.id is not None
    }

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
                        id=image_ids[image.id] if image.id is not None else uuid.uuid4(),
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
        maps=tuple(
            copy_map(source_map, new_room_id, requester.user_id, document_ids, image_ids)
            for source_map in source.maps
            # A mention map lives with its Document, always in the copy.
            if source_map.map.source_document_id is None
            or source_map.map.source_document_id in document_ids
        ),
    )


def copy_map(
    source: SourceMap,
    room_id: uuid.UUID,
    creator: uuid.UUID,
    documents: Mapping[uuid.UUID, uuid.UUID],
    images: Mapping[uuid.UUID, uuid.UUID],
) -> SourceMap:
    """A map of the copy (spec 40 Decisions 1 to 4): fresh ids for the map
    and everything on it, Documents and chosen images re-pointed to their
    copies, `creator` as its creator, Selective turned Private. A background
    keeps naming the same Storage object. Anything that points at a Document
    the copy doesn't hold is left out, with the arrows or links touching it."""
    old = source.map
    map_id = uuid.uuid4()
    center = old.source_document_id
    relationship_map = replace(
        old,
        id=map_id,
        room_id=room_id,
        created_by=creator,
        visibility=_copy_level(old.visibility),
        source_document_id=None if center is None else documents[center],
    )
    group_ids = {group.id: uuid.uuid4() for group in source.board.groups}
    card_ids: dict[uuid.UUID, uuid.UUID] = {}
    cards: list[MapCard] = []
    for card in source.board.cards:
        document_id = None
        if card.document_id is not None:
            document_id = documents.get(card.document_id)
            if document_id is None:
                continue
        # A mention map's card ids are derived from the map and the Document.
        card_ids[card.id] = (
            mention_card_id(map_id, document_id)
            if center is not None and document_id is not None
            else uuid.uuid4()
        )
        cards.append(
            replace(
                card,
                id=card_ids[card.id],
                document_id=document_id,
                group_id=None if card.group_id is None else group_ids.get(card.group_id),
                image_id=None if card.image_id is None else images.get(card.image_id),
            )
        )

    def arrow_end(end: ArrowEnd) -> ArrowEnd | None:
        """The end on the copied board, or None when it was left out."""
        if end.card_id is not None:
            card_id = card_ids.get(end.card_id)
            return None if card_id is None else ArrowEnd(card_id=card_id)
        group_id = group_ids.get(end.id)
        return None if group_id is None else ArrowEnd(group_id=group_id)

    arrows: list[MapArrow] = []
    for arrow in source.board.arrows:
        from_end, to_end = arrow_end(arrow.from_end), arrow_end(arrow.to_end)
        if from_end is not None and to_end is not None:
            arrows.append(replace(arrow, id=uuid.uuid4(), from_end=from_end, to_end=to_end))

    place_ids: dict[uuid.UUID, uuid.UUID] = {}
    areas: list[Area] = []
    pins: list[Pin] = []
    for area in source.geo.areas:
        area_document = None if area.document_id is None else documents.get(area.document_id)
        if area.document_id is None or area_document is not None:
            place_ids[area.id] = uuid.uuid4()
            areas.append(replace(area, id=place_ids[area.id], document_id=area_document))
    for pin in source.geo.pins:
        pin_document = None if pin.document_id is None else documents.get(pin.document_id)
        if pin.document_id is None or pin_document is not None:
            place_ids[pin.id] = uuid.uuid4()
            pins.append(replace(pin, id=place_ids[pin.id], document_id=pin_document))

    def link_end(end: LinkEnd) -> LinkEnd | None:
        """The end on the copied map, or None when it was left out."""
        place_id = place_ids.get(end.id)
        if place_id is None:
            return None
        return LinkEnd(area_id=place_id) if end.area_id is not None else LinkEnd(pin_id=place_id)

    links: list[Link] = []
    for link in source.geo.links:
        link_from, link_to = link_end(link.from_end), link_end(link.to_end)
        if link_from is not None and link_to is not None:
            links.append(replace(link, id=uuid.uuid4(), from_end=link_from, to_end=link_to))

    return SourceMap(
        map=relationship_map,
        board=Board(
            groups=[replace(group, id=group_ids[group.id]) for group in source.board.groups],
            cards=cards,
            arrows=arrows,
        ),
        geo=GeoBoard(areas=areas, pins=pins, links=links),
        linked_document_ids=tuple(
            documents[document_id]
            for document_id in source.linked_document_ids
            if document_id in documents
        ),
    )

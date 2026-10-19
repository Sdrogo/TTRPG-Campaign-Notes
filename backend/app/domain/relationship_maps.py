"""Relationship maps (spec 28_1): free boards of a Room where members place
Documents and text cards, frame them in groups and draw labeled arrows
between them. An arrow belongs to its map only (Decision 1, "free boards"):
it says nothing anywhere else.

Who may see what (Invariant 1, VR-07):

- a map has the Comment levels with its creator as the "Owner" (Decision 3);
- on a map a viewer sees, a Document card shows only when they see its
  Document, a Master-only text card only for a Master (Decisions 4, 6);
- a group shows unless every card in it is hidden from the viewer and it
  has no title (Decision 7);
- an arrow shows when both its ends show and, when Master-only, to a Master
  (Decision 5).

Editing (Decision 12): an editor sends the whole board as they see it;
whatever they don't see is left exactly as it is (`plan_board_edit`)."""

import math
import uuid
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.models import AuditLogEntry, DocumentVisibility, RoomRole
from app.domain.visibility import is_content_visible

MAX_MAPS_PER_ROOM = 100
MAX_CARDS_PER_MAP = 150
MAX_GROUPS_PER_MAP = 30
MAX_ARROWS_PER_MAP = 400
MAX_MAP_NAME_LENGTH = 100
MAX_MAP_DESCRIPTION_LENGTH = 1000
MAX_TEXT_CARD_LENGTH = 300
MAX_CAPTION_LENGTH = 80
MAX_CAPTION_LINES = 2
MAX_LABEL_LENGTH = 60
# The farthest a dragged label may sit from its arrow, in board pixels.
MAX_LABEL_OFFSET = 2000
MAX_GROUP_TITLE_LENGTH = 80
# How far from the origin a card or group may be placed, either way.
MAX_COORDINATE = 100_000.0
MIN_GROUP_SIZE = 40.0
MAX_GROUP_SIZE = 20_000.0

MAP_VISIBILITY_CHANGED = "map_visibility_changed"


class MapColor(StrEnum):
    """The theme colors a card, a label or a group takes (Decision 8): no free
    color picker."""

    DEFAULT = "default"
    RED = "red"
    GREEN = "green"
    PURPLE = "purple"
    BLUE = "blue"
    GOLD = "gold"
    ORANGE = "orange"
    MIDNIGHT = "midnight"
    SILVER = "silver"
    CHAMPAGNE = "champagne"
    ROSE = "rose"
    PINK = "pink"
    COBALT = "cobalt"
    VIOLET = "violet"
    EMERALD = "emerald"
    BROWN = "brown"
    LIME = "lime"


class MapKind(StrEnum):
    """What a map is (spec 38 Decision 1): a free board of cards, or a
    geographic map of areas and pins on a plane. Never changes."""

    FREE = "free"
    GEOGRAPHIC = "geographic"


class CardSize(StrEnum):
    """How large a text card's text is (Decision 6); a Document card is always
    `normal`."""

    NORMAL = "normal"
    LARGE = "large"
    TITLE = "title"


class ArrowDirection(StrEnum):
    """Which way an arrow points (Decision 5): from one end to the other, both
    ways, or neither (a plain line)."""

    FORWARD = "forward"
    BOTH = "both"
    NONE = "none"


class MapNameRequiredError(DomainError):
    """The map's name is empty once trimmed."""


class MapTextTooLongError(DomainError):
    """A name, description, text, caption, label or title is over its limit;
    `field` names which (a key under `errors.map.fields`)."""


class TooManyMapsError(DomainError):
    """The Room already has `MAX_MAPS_PER_ROOM` maps. Answered with 409."""


class MapLimitError(DomainError):
    """The board would hold more cards, groups or arrows than allowed
    (Decision 11), hidden ones included. Answered with 409."""


class InvalidBoardError(DomainError):
    """The board sent can't be stored: an end that isn't on it, a repeated
    Document or id, a card that changes kind, a position out of range.
    Answered with 422."""


class MasterOnlyNotAllowedError(DomainError):
    """Only a Master marks a card or an arrow Master-only. Answered with
    403."""


class BoardDocumentNotFoundError(DomainError):
    """A card names a Document that isn't one of the Room's the editor sees.
    Answered with 404, like the Document itself (VR-07)."""


class BoardImageNotFoundError(DomainError):
    """A Document card names an image its Document doesn't have or the editor
    doesn't see. Answered with 404, like the image itself."""


@dataclass(frozen=True)
class RelationshipMap:
    """A map of a Room. Its creator is its "Owner" for the visibility levels
    and, with the Master, may change it (Decision 2). With
    `source_document_id` it is that Document's live mention map (spec 36),
    following mentions `mention_depth` steps past the first level. A
    `geographic` map (spec 38) has a flat plane of `plane_width` by
    `plane_height` units and may have a stored background image."""

    id: uuid.UUID
    room_id: uuid.UUID
    name: str
    description: str
    visibility: DocumentVisibility
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    source_document_id: uuid.UUID | None = None
    mention_depth: int | None = None
    kind: MapKind = MapKind.FREE
    plane_width: int | None = None
    plane_height: int | None = None
    background_path: str | None = None


@dataclass(frozen=True)
class MapGroup:
    """A framed box on a map holding cards (Decision 7); `x`, `y` is its top
    left corner."""

    id: uuid.UUID
    title: str | None
    color: MapColor
    struck: bool
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class MapCard:
    """A card on a map: a Document (`document_id`) or a text card (`text`),
    never both. `caption` replaces a Document's subtitle on this map only;
    `image_id` is the Document image it shows instead of the Document's
    favorite, on this map only; `group_id` is the group it sits in, if any."""

    id: uuid.UUID
    document_id: uuid.UUID | None
    text: str | None
    group_id: uuid.UUID | None
    caption: str | None
    size: CardSize
    master_only: bool
    color: MapColor
    struck: bool
    x: float
    y: float
    image_id: uuid.UUID | None = None


@dataclass(frozen=True)
class ArrowEnd:
    """One end of an arrow: a card or a group, never both."""

    card_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None

    @property
    def id(self) -> uuid.UUID:
        """The card's or the group's id."""
        end = self.card_id if self.card_id is not None else self.group_id
        assert end is not None
        return end


@dataclass(frozen=True)
class MapArrow:
    """An arrow between two ends of a map. `label` is the only label of a
    one-way arrow or a plain line, the one pointing at `to` on a two-way
    arrow; `reverse_label`, two-way only, the one pointing at `from_end`.
    `label_position` and `reverse_label_position` are where each label sits
    along the arrow (0 at `from_end`, 1 at `to_end`), or None for the
    board's automatic placement. `label_offset` and `reverse_label_offset` are
    how far, in board pixels, a dragged label sits to the side of the arrow
    (negative to the other side); they only exist with a position."""

    id: uuid.UUID
    from_end: ArrowEnd
    to_end: ArrowEnd
    direction: ArrowDirection
    label: str | None
    reverse_label: str | None
    color: MapColor
    master_only: bool
    label_position: float | None = None
    reverse_label_position: float | None = None
    label_offset: float | None = None
    reverse_label_offset: float | None = None


@dataclass(frozen=True)
class Board:
    """Everything on a map: its groups, cards and arrows."""

    groups: Sequence[MapGroup] = ()
    cards: Sequence[MapCard] = ()
    arrows: Sequence[MapArrow] = ()


@dataclass(frozen=True)
class BoardPlan:
    """What a board save writes: items to create or rewrite (`upsert`, the
    editor's whole visible board, cleaned, plus any hidden card taken out of
    a deleted group) and ids to delete, per kind."""

    groups: Sequence[MapGroup]
    cards: Sequence[MapCard]
    arrows: Sequence[MapArrow]
    delete_group_ids: Collection[uuid.UUID] = field(default_factory=frozenset)
    delete_card_ids: Collection[uuid.UUID] = field(default_factory=frozenset)
    delete_arrow_ids: Collection[uuid.UUID] = field(default_factory=frozenset)


# --- Who may do what ----------------------------------------------------------


def can_create_map(role: RoomRole, players_can_create_documents: bool) -> bool:
    """Decision 2: every member creates maps, a Player only while the Room
    lets Players create Documents (D-13)."""
    return role == RoomRole.MASTER or players_can_create_documents


def can_manage_map(relationship_map: RelationshipMap, user_id: uuid.UUID, role: RoomRole) -> bool:
    """Decision 2: the map's creator and the Master edit, rename and delete
    it; everyone else only looks at it."""
    return role == RoomRole.MASTER or user_id == relationship_map.created_by


def is_map_visible(
    relationship_map: RelationshipMap,
    user_id: uuid.UUID,
    role: RoomRole,
    selective_user_ids: Collection[uuid.UUID],
) -> bool:
    """Decision 3: the Comment levels with the creator as the "Owner" (Room,
    Master only, Private, Selective). A map hidden from a member is absent
    from the list and 404 when asked."""
    return is_content_visible(
        relationship_map.visibility,
        user_id,
        role,
        {relationship_map.created_by},
        selective_user_ids,
    )


# --- What a viewer sees on a map ----------------------------------------------


def visible_cards(
    cards: Iterable[MapCard], visible_document_ids: Collection[uuid.UUID], role: RoomRole
) -> list[MapCard]:
    """Decisions 4 and 6: a Document card only when the viewer sees its
    Document, a Master-only text card only for a Master. A hidden card is
    simply absent: no empty box, no count."""
    return [
        card
        for card in cards
        if (card.document_id in visible_document_ids if card.document_id is not None else True)
        and (not card.master_only or role == RoomRole.MASTER)
    ]


def visible_groups(
    groups: Iterable[MapGroup], cards: Iterable[MapCard], shown_cards: Iterable[MapCard]
) -> list[MapGroup]:
    """Decision 7: a group is drawn unless it holds cards, every one of them
    hidden from the viewer, and has no title, which would show an empty frame
    where something is hidden. An empty group hides nothing and is drawn."""
    held = {card.group_id for card in cards if card.group_id is not None}
    shown = {card.group_id for card in shown_cards if card.group_id is not None}
    return [
        group
        for group in groups
        if group.title is not None or group.id in shown or group.id not in held
    ]


def visible_arrows(
    arrows: Iterable[MapArrow],
    shown_card_ids: Collection[uuid.UUID],
    shown_group_ids: Collection[uuid.UUID],
    role: RoomRole,
) -> list[MapArrow]:
    """Decision 5: an arrow shows when both its ends do (a card the viewer
    sees, a group that is drawn) and, when Master-only, only to a Master."""

    def shows(end: ArrowEnd) -> bool:
        """Whether that end is on the viewer's board."""
        if end.card_id is not None:
            return end.card_id in shown_card_ids
        return end.group_id in shown_group_ids

    return [
        arrow
        for arrow in arrows
        if shows(arrow.from_end)
        and shows(arrow.to_end)
        and (not arrow.master_only or role == RoomRole.MASTER)
    ]


def visible_board(
    board: Board, visible_document_ids: Collection[uuid.UUID], role: RoomRole
) -> Board:
    """The board as one viewer sees it (Invariant 1): `visible_cards`, then
    the groups and arrows that follow from them."""
    cards = visible_cards(board.cards, visible_document_ids, role)
    groups = visible_groups(board.groups, board.cards, cards)
    arrows = visible_arrows(
        board.arrows, {card.id for card in cards}, {group.id for group in groups}, role
    )
    return Board(groups=groups, cards=cards, arrows=arrows)


# --- Cleaning what is sent ----------------------------------------------------


def clean_line(value: str | None, limit: int, field_key: str) -> str | None:
    """One line of plain text: whitespace collapsed, ends trimmed, None when
    empty; `MapTextTooLongError` past `limit` characters."""
    if value is None:
        return None
    cleaned = " ".join(value.split())
    if len(cleaned) > limit:
        raise MapTextTooLongError(
            "errors.map.tooLong", field=f"@errors.map.fields.{field_key}", max=limit
        )
    return cleaned or None


def clean_lines(
    value: str | None, limit: int, field_key: str, max_lines: int | None = None
) -> str | None:
    """Text over several lines: each line's spaces collapsed and blank lines
    at either end dropped, None when empty; at most `max_lines` lines and
    `limit` characters."""
    if value is None:
        return None
    lines = [" ".join(line.split()) for line in value.strip().splitlines()]
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[: max_lines - 1] + [" ".join(lines[max_lines - 1 :])]
    cleaned = "\n".join(lines).strip()
    if len(cleaned) > limit:
        raise MapTextTooLongError(
            "errors.map.tooLong", field=f"@errors.map.fields.{field_key}", max=limit
        )
    return cleaned or None


def clean_map_fields(name: str, description: str) -> tuple[str, str]:
    """A map's name (required, at most `MAX_MAP_NAME_LENGTH`) and description
    (optional, at most `MAX_MAP_DESCRIPTION_LENGTH`), cleaned."""
    clean_name = clean_line(name, MAX_MAP_NAME_LENGTH, "name")
    if clean_name is None:
        raise MapNameRequiredError("errors.map.nameRequired")
    return clean_name, clean_lines(description, MAX_MAP_DESCRIPTION_LENGTH, "description") or ""


def ensure_room_for_another_map(current_count: int) -> None:
    """Decision 11: at most `MAX_MAPS_PER_ROOM` maps per Room."""
    if current_count >= MAX_MAPS_PER_ROOM:
        raise TooManyMapsError("errors.map.tooMany", max=MAX_MAPS_PER_ROOM)


def map_visibility_audit(
    before: RelationshipMap,
    after: RelationshipMap,
    editor_id: uuid.UUID,
    current_selective_ids: Collection[uuid.UUID],
    new_selective_ids: Collection[uuid.UUID] | None,
) -> AuditLogEntry | None:
    """Decision 3: the AuditLog row for an edit that changes who can see a
    map, its level or its Selective grants (Invariant 7), or None when it
    changes neither."""
    grants_changed = new_selective_ids is not None and set(new_selective_ids) != set(
        current_selective_ids
    )
    if after.visibility == before.visibility and not grants_changed:
        return None
    grants = current_selective_ids if new_selective_ids is None else new_selective_ids
    return AuditLogEntry(
        id=uuid.uuid4(),
        room_id=before.room_id,
        actor_user_id=editor_id,
        target_user_id=None,
        action=MAP_VISIBILITY_CHANGED,
        details={
            "map_id": str(before.id),
            "from": before.visibility.value,
            "to": after.visibility.value,
            "selective_user_ids": sorted(str(user_id) for user_id in grants),
        },
    )


# --- Saving a board -----------------------------------------------------------


def _ensure_position(*values: float) -> None:
    """422 for a coordinate that isn't a finite number within
    `MAX_COORDINATE`."""
    for value in values:
        if not math.isfinite(value) or abs(value) > MAX_COORDINATE:
            raise InvalidBoardError("errors.map.invalidBoard")


def _clean_group(group: MapGroup) -> MapGroup:
    """A group with its title cleaned and its frame within range."""
    _ensure_position(group.x, group.y)
    if not (MIN_GROUP_SIZE <= group.width <= MAX_GROUP_SIZE) or not (
        MIN_GROUP_SIZE <= group.height <= MAX_GROUP_SIZE
    ):
        raise InvalidBoardError("errors.map.invalidBoard")
    return MapGroup(
        id=group.id,
        title=clean_line(group.title, MAX_GROUP_TITLE_LENGTH, "groupTitle"),
        color=group.color,
        struck=group.struck,
        x=group.x,
        y=group.y,
        width=group.width,
        height=group.height,
    )


def _clean_card(card: MapCard) -> MapCard:
    """A card with its texts cleaned: a Document card keeps no text and no
    size of its own, a text card no caption."""
    _ensure_position(card.x, card.y)
    if card.document_id is not None:
        return MapCard(
            id=card.id,
            document_id=card.document_id,
            text=None,
            group_id=card.group_id,
            caption=clean_lines(card.caption, MAX_CAPTION_LENGTH, "caption", MAX_CAPTION_LINES),
            size=CardSize.NORMAL,
            master_only=False,
            color=card.color,
            struck=card.struck,
            x=card.x,
            y=card.y,
            image_id=card.image_id,
        )
    text = clean_lines(card.text, MAX_TEXT_CARD_LENGTH, "text")
    if text is None:
        raise InvalidBoardError("errors.map.invalidBoard")
    return MapCard(
        id=card.id,
        document_id=None,
        text=text,
        group_id=card.group_id,
        caption=None,
        size=card.size,
        master_only=card.master_only,
        color=card.color,
        struck=card.struck,
        x=card.x,
        y=card.y,
    )


def clean_label_position(position: float | None, label: str | None) -> float | None:
    """A label's place along its arrow: 422 outside 0 to 1, and none for a
    label that does not exist."""
    if position is None or label is None:
        return None
    if not 0 <= position <= 1:
        raise InvalidBoardError("errors.map.invalidBoard")
    return position


def clean_label_offset(offset: float | None, position: float | None) -> float | None:
    """A label's distance from its arrow: 422 beyond the largest a board
    allows, and none for a label without a place."""
    if offset is None or position is None:
        return None
    if not -MAX_LABEL_OFFSET <= offset <= MAX_LABEL_OFFSET:
        raise InvalidBoardError("errors.map.invalidBoard")
    return offset


def _clean_arrow(arrow: MapArrow) -> MapArrow:
    """An arrow with its labels cleaned; only a two-way arrow keeps a reverse
    label. A label keeps the place it was dragged to only while it exists."""
    label = clean_line(arrow.label, MAX_LABEL_LENGTH, "label")
    reverse_label = (
        clean_line(arrow.reverse_label, MAX_LABEL_LENGTH, "label")
        if arrow.direction == ArrowDirection.BOTH
        else None
    )
    label_position = clean_label_position(arrow.label_position, label)
    reverse_label_position = clean_label_position(arrow.reverse_label_position, reverse_label)
    return MapArrow(
        id=arrow.id,
        from_end=arrow.from_end,
        to_end=arrow.to_end,
        direction=arrow.direction,
        label=label,
        reverse_label=reverse_label,
        color=arrow.color,
        master_only=arrow.master_only,
        label_position=label_position,
        reverse_label_position=reverse_label_position,
        label_offset=clean_label_offset(arrow.label_offset, label_position),
        reverse_label_offset=clean_label_offset(arrow.reverse_label_offset, reverse_label_position),
    )


def _ensure_unique_ids(items: Sequence[MapGroup] | Sequence[MapCard] | Sequence[MapArrow]) -> None:
    """422 when the same id is sent twice."""
    ids = [item.id for item in items]
    if len(ids) != len(set(ids)):
        raise InvalidBoardError("errors.map.invalidBoard")


def plan_board_edit(
    current: Board,
    shown: Board,
    submitted: Board,
    editor_role: RoomRole,
    editor_visible_document_ids: Collection[uuid.UUID],
    foreign_ids: Collection[uuid.UUID] = frozenset(),
    editor_visible_image_ids: Mapping[uuid.UUID, Collection[uuid.UUID]] | None = None,
) -> BoardPlan:
    """Decision 12: applies the board an editor sends (`submitted`, the whole
    of what they see) to the map. `current` is everything on the map, `shown`
    the part this editor sees (`visible_board`); `foreign_ids` the submitted
    ids already used by another map or kind. What the editor sees and didn't
    send is deleted; what they don't see is never touched, read or counted
    as theirs, like Notes in `plan_note_order`.

    Refused: an id of something hidden from the editor or of another map
    (422, so a hidden item can't be overwritten by guessing its id); a card
    that changes kind or Document; a Document twice on the map; a Document
    the editor doesn't see or of another Room, or an image of it they don't
    see (`editor_visible_image_ids`, per Document) (404); a card in a group or an
    arrow end not on the resulting board, or an arrow from an end to itself
    (422); Master-only content from anyone but a Master (403); more than the
    caps, counted over everything on the map (409)."""
    for items in (submitted.groups, submitted.cards, submitted.arrows):
        _ensure_unique_ids(items)

    every_id = (
        {group.id for group in current.groups}
        | {card.id for card in current.cards}
        | {arrow.id for arrow in current.arrows}
    )
    shown_groups = {group.id: group for group in shown.groups}
    shown_cards = {card.id: card for card in shown.cards}
    shown_arrows = {arrow.id: arrow for arrow in shown.arrows}
    sent_ids = (
        [group.id for group in submitted.groups]
        + [card.id for card in submitted.cards]
        + [arrow.id for arrow in submitted.arrows]
    )
    if len(sent_ids) != len(set(sent_ids)) or set(sent_ids) & set(foreign_ids):
        raise InvalidBoardError("errors.map.invalidBoard")

    def ensure_not_hidden(item_id: uuid.UUID, shown_ids: Collection[uuid.UUID]) -> None:
        """An id already on the map must be one the editor sees, as the same
        kind of thing."""
        if item_id in every_id and item_id not in shown_ids:
            raise InvalidBoardError("errors.map.invalidBoard")

    for group in submitted.groups:
        ensure_not_hidden(group.id, shown_groups)
    for card in submitted.cards:
        ensure_not_hidden(card.id, shown_cards)
    for arrow in submitted.arrows:
        ensure_not_hidden(arrow.id, shown_arrows)

    groups = [_clean_group(group) for group in submitted.groups]
    cards = [_clean_card(card) for card in submitted.cards]
    arrows = [_clean_arrow(arrow) for arrow in submitted.arrows]

    is_master = editor_role == RoomRole.MASTER
    hidden_cards = [card for card in current.cards if card.id not in shown_cards]
    hidden_groups = [group for group in current.groups if group.id not in shown_groups]
    hidden_arrows = [arrow for arrow in current.arrows if arrow.id not in shown_arrows]

    group_ids = {group.id for group in groups}
    documents_on_map = [card.document_id for card in hidden_cards if card.document_id]
    for card in cards:
        before = shown_cards.get(card.id)
        if before is not None and before.document_id != card.document_id:
            raise InvalidBoardError("errors.map.invalidBoard")
        if card.document_id is not None:
            if card.document_id not in editor_visible_document_ids:
                raise BoardDocumentNotFoundError("errors.document.notFound")
            documents_on_map.append(card.document_id)
            if card.image_id is not None and card.image_id not in (
                (editor_visible_image_ids or {}).get(card.document_id, ())
            ):
                raise BoardImageNotFoundError("errors.map.imageNotFound")
        if card.group_id is not None and card.group_id not in group_ids:
            raise InvalidBoardError("errors.map.invalidBoard")
        if card.master_only and not is_master:
            raise MasterOnlyNotAllowedError("errors.map.masterOnly")
    if len(documents_on_map) != len(set(documents_on_map)):
        raise InvalidBoardError("errors.map.invalidBoard")

    card_ids = {card.id for card in cards}
    for arrow in arrows:
        for end in (arrow.from_end, arrow.to_end):
            if end.card_id is not None and end.card_id not in card_ids:
                raise InvalidBoardError("errors.map.invalidBoard")
            if end.group_id is not None and end.group_id not in group_ids:
                raise InvalidBoardError("errors.map.invalidBoard")
        if arrow.from_end.id == arrow.to_end.id:
            raise InvalidBoardError("errors.map.invalidBoard")
        if arrow.master_only and not is_master:
            raise MasterOnlyNotAllowedError("errors.map.masterOnly")

    # A hidden arrow whose shown end the editor deletes goes with it (the
    # database cascades); it no longer counts.
    kept_ids = card_ids | group_ids | {card.id for card in hidden_cards}
    kept_ids |= {group.id for group in hidden_groups}
    surviving_hidden_arrows = [
        arrow
        for arrow in hidden_arrows
        if arrow.from_end.id in kept_ids and arrow.to_end.id in kept_ids
    ]
    if len(cards) + len(hidden_cards) > MAX_CARDS_PER_MAP:
        raise MapLimitError("errors.map.tooManyCards", max=MAX_CARDS_PER_MAP)
    if len(groups) + len(hidden_groups) > MAX_GROUPS_PER_MAP:
        raise MapLimitError("errors.map.tooManyGroups", max=MAX_GROUPS_PER_MAP)
    if len(arrows) + len(surviving_hidden_arrows) > MAX_ARROWS_PER_MAP:
        raise MapLimitError("errors.map.tooManyArrows", max=MAX_ARROWS_PER_MAP)

    # A hidden card in a group the editor deletes stays where it was drawn:
    # its position was relative to the group, so it becomes absolute.
    delete_group_ids = frozenset(shown_groups.keys() - group_ids)
    released_cards = [
        _release_from_group(card, shown_groups[card.group_id])
        for card in hidden_cards
        if card.group_id in delete_group_ids
    ]

    return BoardPlan(
        groups=groups,
        cards=[*cards, *released_cards],
        arrows=arrows,
        delete_group_ids=delete_group_ids,
        delete_card_ids=frozenset(shown_cards.keys() - card_ids),
        delete_arrow_ids=frozenset(shown_arrows.keys() - {arrow.id for arrow in arrows}),
    )


def _release_from_group(card: MapCard, group: MapGroup) -> MapCard:
    """`card` taken out of `group`, at the same place on the board."""

    def absolute(offset: float, corner: float) -> float:
        return max(-MAX_COORDINATE, min(MAX_COORDINATE, corner + offset))

    return replace(card, group_id=None, x=absolute(card.x, group.x), y=absolute(card.y, group.y))


def document_card_counts(
    cards_by_map: Mapping[uuid.UUID, Sequence[MapCard]],
    visible_document_ids: Collection[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """For the list of maps (Decision 1): how many Documents each map shows
    the viewer, never counting one they can't see (VR-07)."""
    return {
        map_id: sum(
            1
            for card in cards
            if card.document_id is not None and card.document_id in visible_document_ids
        )
        for map_id, cards in cards_by_map.items()
    }

"""Mention maps (spec 36): a Document's live relationship map, computed from
its mentions every time it is read. Only the depth and the cards someone
moved or recolored are stored; the Documents and relations come from the
mentions the viewer sees (Decision 7), so a hidden mention never draws an
arrow, and a Document reachable only through one is not on the map.

Everything here is pure: the routes collect the visible mentions, step by
step, and hand them over as links."""

import math
import uuid
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.domain.errors import DomainError
from app.domain.relationship_maps import (
    MAX_CARDS_PER_MAP,
    ArrowDirection,
    ArrowEnd,
    Board,
    CardSize,
    MapArrow,
    MapCard,
    MapColor,
)

MAX_MENTION_DEPTH = 3
"""Decision 2: at most three steps past the first level."""

CENTER_COLOR = MapColor.GOLD
"""Decision 6: the center Document's card stands out in gold."""

# Decision 6, in board pixels: a card is 160 wide and up to 240 tall (an
# image card, `DocumentCardNode`). Two cards whose centers are at least SLOT
# apart never overlap (SLOT is just over the card's diagonal, 288), so cards
# on one ring sit SLOT apart and rings are SLOT apart: as tight as the cards
# allow.
CARD_WIDTH = 160
CARD_HEIGHT = 240
SLOT = 290
FIRST_RING_RADIUS = 300


class MentionDepthError(DomainError):
    """Decision 2: the depth is a whole number from 0 to 3. Answered with
    422."""


class NothingToMapError(DomainError):
    """Decision 11: the Document has no mention the user sees, so a map
    would hold only its own card; nothing is created. Answered with 409."""


class Side(StrEnum):
    """Where a first-ring card sits around the center (Decision 6): the
    Documents that only mention it on the left, those it only mentions on
    the right, mutual ones at the top and bottom."""

    MENTIONS_CENTER = "left"
    MENTIONED_BY_CENTER = "right"
    MUTUAL = "mutual"


@dataclass(frozen=True)
class GraphCard:
    """A Document on the map: `step` 0 is the center, 1 the first ring;
    `parent_id` is the card that brought it in (None for the center)."""

    document_id: uuid.UUID
    step: int
    parent_id: uuid.UUID | None


@dataclass(frozen=True)
class GraphRelation:
    """A relation between two cards (Decisions 4, 5): `from_id` mentions
    `to_id`, or they mention each other (`BOTH`)."""

    from_id: uuid.UUID
    to_id: uuid.UUID
    direction: ArrowDirection


@dataclass(frozen=True)
class MentionGraph:
    """The cards and relations of a mention map as one viewer sees it, and
    how many Documents the 150-card cap left out (Decision 10)."""

    cards: Sequence[GraphCard]
    relations: Sequence[GraphRelation]
    left_out: int


def ensure_something_to_map(graph: MentionGraph) -> None:
    """Decision 11: refuses a map with no relation the user sees."""
    if not graph.relations:
        raise NothingToMapError("errors.mentionMap.nothingToMap")


def ensure_depth(depth: int) -> int:
    """`depth` once it is within Decision 2's bounds, else
    `MentionDepthError`."""
    if not 0 <= depth <= MAX_MENTION_DEPTH:
        raise MentionDepthError("errors.mentionMap.invalidDepth")
    return depth


def next_ring(
    frontier: Iterable[uuid.UUID],
    links: Iterable[tuple[uuid.UUID, uuid.UUID]],
    known: Iterable[uuid.UUID],
) -> set[uuid.UUID]:
    """The Documents one mention away from `frontier`, in either direction,
    that aren't already `known` (Decision 3: never repeated)."""
    frontier_ids = set(frontier)
    seen = set(known)
    found: set[uuid.UUID] = set()
    for source, target in links:
        if source in frontier_ids and target not in seen:
            found.add(target)
        if target in frontier_ids and source not in seen:
            found.add(source)
    return found


def mention_graph(
    center_id: uuid.UUID,
    depth: int,
    links: Iterable[tuple[uuid.UUID, uuid.UUID]],
    names: Mapping[uuid.UUID, str],
    limit: int = MAX_CARDS_PER_MAP,
) -> MentionGraph:
    """The map around `center_id` (Decisions 2 to 5, 10). `links` holds one
    `(source, target)` pair per visible mention (repeats count how strongly
    two Documents are linked); `names` the Documents' names, for a stable
    order. Rings are walked breadth-first, `depth + 1` of them; each card
    remembers the first card of the previous ring (by name) that reached it.
    Past `limit` cards the nearest rings win, then the Documents with the
    most mentions, then by name. Only the mentions that tie a card to the
    card that brought it in become relations (the center's own mentions, on
    the first ring), one per pair, two-way when they mention each other:
    mentions between the other Documents would drown the map (product
    owner, 2026-10-14)."""
    counts = Counter((source, target) for source, target in links if source != target)
    neighbors: dict[uuid.UUID, set[uuid.UUID]] = {}
    for source, target in counts:
        neighbors.setdefault(source, set()).add(target)
        neighbors.setdefault(target, set()).add(source)
    weight: Counter[uuid.UUID] = Counter()
    for (source, target), count in counts.items():
        weight[source] += count
        weight[target] += count

    def order(document_id: uuid.UUID) -> tuple[str, str]:
        """By name, then id, so equal names keep a fixed order."""
        return (names.get(document_id, "").casefold(), str(document_id))

    cards = [GraphCard(center_id, 0, None)]
    known = {center_id}
    ring = [center_id]
    for step in range(1, depth + 2):
        reached: dict[uuid.UUID, uuid.UUID] = {}
        for parent in sorted(ring, key=order):
            for document_id in sorted(neighbors.get(parent, ()), key=order):
                if document_id not in known and document_id not in reached:
                    reached[document_id] = parent
        if not reached:
            break
        cards.extend(GraphCard(d, step, p) for d, p in reached.items())
        known.update(reached)
        ring = list(reached)

    ranked = sorted(cards, key=lambda c: (c.step, -weight[c.document_id], *order(c.document_id)))
    kept = ranked[:limit]
    # A card's parent is on an earlier ring, so it ranks before the card and
    # is kept whenever the card is.
    tree = {frozenset((card.document_id, card.parent_id)) for card in kept if card.parent_id}
    relations: list[GraphRelation] = []
    for source, target in sorted(counts, key=lambda pair: (*order(pair[0]), *order(pair[1]))):
        if frozenset((source, target)) not in tree:
            continue
        if (target, source) in counts:
            if order(source) < order(target):
                relations.append(GraphRelation(source, target, ArrowDirection.BOTH))
            continue
        relations.append(GraphRelation(source, target, ArrowDirection.FORWARD))
    return MentionGraph(cards=kept, relations=relations, left_out=len(cards) - len(kept))


def first_ring_side(center_id: uuid.UUID, document_id: uuid.UUID, graph: MentionGraph) -> Side:
    """Decision 6: which side of the center a first-ring card takes."""
    for relation in graph.relations:
        if {relation.from_id, relation.to_id} != {center_id, document_id}:
            continue
        if relation.direction == ArrowDirection.BOTH:
            return Side.MUTUAL
        if relation.from_id == center_id:
            return Side.MENTIONED_BY_CENTER
        return Side.MENTIONS_CENTER
    # Only reachable when the cap cut the relation's other end: never for a
    # first-ring card, whose center is always kept.
    return Side.MUTUAL  # pragma: no cover


def _ring_gap(radius: float) -> float:
    """The angle between two neighbors on a ring of `radius`, SLOT apart."""
    return 2 * math.asin(min(1.0, SLOT / 2 / radius))


def _place_around(desired: Sequence[float], gap: float) -> list[float]:
    """Angles as close as possible to `desired` (sorted) with at least `gap`
    between neighbors; evenly around the circle when they don't fit."""
    placed: list[float] = []
    for angle in desired:
        placed.append(angle if not placed else max(angle, placed[-1] + gap))
    if placed and placed[-1] - placed[0] > 2 * math.pi - gap:
        step = 2 * math.pi / len(placed)
        return [placed[0] + step * index for index in range(len(placed))]
    return placed


def _first_ring(count: int) -> list[tuple[float, float]]:
    """`count` places (radius, angle) packed around the center, in angular
    order: rings SLOT apart, each filled with as many cards as it holds, the
    last one evenly with what is left. Every ring's cards are spread evenly
    and the rings are interleaved by angle, so going around the center
    meets the cards in their given order whatever ring they sit on."""
    slots: list[tuple[float, float]] = []
    radius = FIRST_RING_RADIUS
    left = count
    ring_index = 0
    while left:
        holds = max(1, int(2 * math.pi / _ring_gap(radius)))
        here = min(holds, left)
        # Staggered by half a slot from the ring inside it.
        offset = 0.5 * ring_index
        slots.extend(
            ((2 * math.pi * (index + offset) / here) % (2 * math.pi), radius)
            for index in range(here)
        )
        left -= here
        radius += SLOT
        ring_index += 1
    return [(radius, angle) for angle, radius in sorted(slots)]


def ring_layout(
    graph: MentionGraph, names: Mapping[uuid.UUID, str]
) -> dict[uuid.UUID, tuple[float, float]]:
    """Decision 6: each card's top-left corner on the board. The center at
    the origin; the first ring packed around it as tightly as the cards
    allow, in four arcs going clockwise from the top: half the mutual ones,
    those the center mentions (right), the other mutual ones, those
    mentioning it (left), by name inside each; each further ring just
    outside, each card near the angle of the card that brought it in. Cards
    never overlap. Deterministic for a given graph."""
    centers: dict[uuid.UUID, tuple[float, float]] = {}
    angles: dict[uuid.UUID, float] = {}
    center = next(card for card in graph.cards if card.step == 0)
    centers[center.document_id] = (0.0, 0.0)

    def order(document_id: uuid.UUID) -> tuple[str, str]:
        """By name, then id."""
        return (names.get(document_id, "").casefold(), str(document_id))

    radius = 0.0
    last_step = max(card.step for card in graph.cards)
    for step in range(1, last_step + 1):
        ring = [card for card in graph.cards if card.step == step]
        if step == 1:
            sides: dict[Side, list[uuid.UUID]] = {side: [] for side in Side}
            for card in sorted(ring, key=lambda c: order(c.document_id)):
                sides[first_ring_side(center.document_id, card.document_id, graph)].append(
                    card.document_id
                )
            mutual = sides[Side.MUTUAL]
            half = (len(mutual) + 1) // 2
            around = [
                *mutual[:half],
                *sides[Side.MENTIONED_BY_CENTER],
                *mutual[half:],
                *sides[Side.MENTIONS_CENTER],
            ]
            # Screen coordinates: y grows downwards, so -90° is the top and
            # angles grow clockwise. Turned so the top arc is centered on it.
            turn = -math.pi / 2 - math.pi * half / len(around)
            for document_id, (ring_radius, angle) in zip(
                around, _first_ring(len(around)), strict=True
            ):
                angles[document_id] = angle + turn
                radius = max(radius, ring_radius)
                centers[document_id] = (
                    ring_radius * math.cos(angle + turn),
                    ring_radius * math.sin(angle + turn),
                )
            continue
        # Wide enough for the whole ring evenly spread, SLOT apart.
        evenly = SLOT / (2 * math.sin(math.pi / len(ring))) if len(ring) > 1 else 0.0
        radius = max(radius + SLOT, evenly)
        wanted = sorted(
            ring,
            key=lambda c: (angles[c.parent_id or center.document_id], *order(c.document_id)),
        )
        placed = _place_around(
            [angles[card.parent_id or center.document_id] for card in wanted], _ring_gap(radius)
        )
        for card, angle in zip(wanted, placed, strict=True):
            angles[card.document_id] = angle
            centers[card.document_id] = (radius * math.cos(angle), radius * math.sin(angle))
    return {
        document_id: (round(x - CARD_WIDTH / 2), round(y - CARD_HEIGHT / 2))
        for document_id, (x, y) in centers.items()
    }


def mention_card_id(map_id: uuid.UUID, document_id: uuid.UUID) -> uuid.UUID:
    """A Document card's id on a mention map: the same on every read, so the
    board and a saved position agree."""
    return uuid.uuid5(map_id, f"card:{document_id}")


def mention_arrow_id(map_id: uuid.UUID, relation: GraphRelation) -> uuid.UUID:
    """A relation's id on a mention map, the same on every read."""
    return uuid.uuid5(map_id, f"arrow:{relation.from_id}:{relation.to_id}")


def mention_board(
    map_id: uuid.UUID,
    graph: MentionGraph,
    names: Mapping[uuid.UUID, str],
    saved: Iterable[MapCard],
) -> tuple[list[MapCard], list[MapArrow]]:
    """The map's cards and relations as spec 28 cards and arrows (Decisions
    5, 6, 9): a card someone moved or recolored keeps its saved place and
    color, every other card takes `ring_layout`'s place and the default
    color (gold for the center); relations have no label."""
    saved_cards = {card.document_id: card for card in saved}
    positions = ring_layout(graph, names)
    cards: list[MapCard] = []
    for card in graph.cards:
        stored = saved_cards.get(card.document_id)
        x, y = positions[card.document_id]
        color = CENTER_COLOR if card.step == 0 else MapColor.DEFAULT
        cards.append(
            MapCard(
                id=mention_card_id(map_id, card.document_id),
                document_id=card.document_id,
                text=None,
                group_id=None,
                caption=None,
                size=CardSize.NORMAL,
                master_only=False,
                color=stored.color if stored is not None else color,
                struck=False,
                x=stored.x if stored is not None else x,
                y=stored.y if stored is not None else y,
            )
        )
    arrows = [
        MapArrow(
            id=mention_arrow_id(map_id, relation),
            from_end=ArrowEnd(card_id=mention_card_id(map_id, relation.from_id)),
            to_end=ArrowEnd(card_id=mention_card_id(map_id, relation.to_id)),
            direction=relation.direction,
            label=None,
            reverse_label=None,
            color=MapColor.DEFAULT,
            master_only=False,
        )
        for relation in graph.relations
    ]
    return cards, arrows


def _anchor(
    board: Board,
    center_id: uuid.UUID,
    positions: Mapping[uuid.UUID, tuple[float, float]],
) -> tuple[float, float]:
    """How far to shift `ring_layout`'s places to add them to `board`
    (Decision 15): around the center Document's card when it is already
    there, else just right of everything on the board, vertically centered on
    it; as they are on an empty board."""
    center_card = next((card for card in board.cards if card.document_id == center_id), None)
    if center_card is not None:
        x, y = positions[center_id]
        return center_card.x - x, center_card.y - y
    boxes = [
        (card.x, card.y, card.x + CARD_WIDTH, card.y + CARD_HEIGHT) for card in board.cards
    ] + [
        (group.x, group.y, group.x + group.width, group.y + group.height) for group in board.groups
    ]
    if not boxes:
        return 0.0, 0.0
    right = max(box[2] for box in boxes)
    middle = (min(box[1] for box in boxes) + max(box[3] for box in boxes)) / 2
    layout_left = min(x for x, _ in positions.values())
    layout_middle = (
        min(y for _, y in positions.values()) + max(y for _, y in positions.values()) + CARD_HEIGHT
    ) / 2
    return right + SLOT - CARD_WIDTH - layout_left, middle - layout_middle


def add_to_board(
    board: Board,
    graph: MentionGraph,
    names: Mapping[uuid.UUID, str],
    new_id: Callable[[], uuid.UUID],
) -> tuple[list[MapCard], list[MapArrow]]:
    """Decision 15: the cards and arrows that add a Document's mention graph
    to an existing free map, as `board` shows it to the user. A Document
    already on the board keeps its card (the first one, if several) and
    place; every other one gets a new card laid out as on a mention map,
    around the center's card when it is already there, else beside the
    board. A relation already drawn between the same two cards, in any
    direction, is not drawn again."""
    positions = ring_layout(graph, names)
    center_id = next(card.document_id for card in graph.cards if card.step == 0)
    dx, dy = _anchor(board, center_id, positions)
    card_ids: dict[uuid.UUID, uuid.UUID] = {}
    for existing in board.cards:
        if existing.document_id is not None:
            card_ids.setdefault(existing.document_id, existing.id)
    cards: list[MapCard] = []
    for card in graph.cards:
        if card.document_id in card_ids:
            continue
        card_ids[card.document_id] = new_id()
        x, y = positions[card.document_id]
        cards.append(
            MapCard(
                id=card_ids[card.document_id],
                document_id=card.document_id,
                text=None,
                group_id=None,
                caption=None,
                size=CardSize.NORMAL,
                master_only=False,
                color=CENTER_COLOR if card.step == 0 else MapColor.DEFAULT,
                struck=False,
                x=round(x + dx),
                y=round(y + dy),
            )
        )
    drawn = {
        frozenset((arrow.from_end.id, arrow.to_end.id))
        for arrow in board.arrows
        if arrow.from_end.card_id is not None and arrow.to_end.card_id is not None
    }
    arrows: list[MapArrow] = []
    for relation in graph.relations:
        ends = (card_ids[relation.from_id], card_ids[relation.to_id])
        if frozenset(ends) in drawn:
            continue
        drawn.add(frozenset(ends))
        arrows.append(
            MapArrow(
                id=new_id(),
                from_end=ArrowEnd(card_id=ends[0]),
                to_end=ArrowEnd(card_id=ends[1]),
                direction=relation.direction,
                label=None,
                reverse_label=None,
                color=MapColor.DEFAULT,
                master_only=False,
            )
        )
    return cards, arrows

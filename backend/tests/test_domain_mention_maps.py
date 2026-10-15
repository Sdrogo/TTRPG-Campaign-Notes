"""Mention maps (spec 36): the graph walked from the visible mentions, its
cap, and the ring layout."""

import math
import uuid
from collections.abc import Callable

import pytest

from app.domain.mention_maps import (
    CARD_HEIGHT,
    CARD_WIDTH,
    FIRST_RING_RADIUS,
    SLOT,
    MentionDepthError,
    NothingToMapError,
    Side,
    _place_around,
    add_to_board,
    ensure_depth,
    ensure_something_to_map,
    first_ring_side,
    mention_board,
    mention_card_id,
    mention_graph,
    next_ring,
    ring_layout,
)
from app.domain.relationship_maps import (
    ArrowDirection,
    ArrowEnd,
    Board,
    CardSize,
    MapArrow,
    MapCard,
    MapColor,
    MapGroup,
)


def _ids(count: int) -> list[uuid.UUID]:
    return [uuid.UUID(int=index + 1) for index in range(count)]


def test_depth_is_checked() -> None:
    assert ensure_depth(0) == 0
    assert ensure_depth(3) == 3
    for depth in (-1, 4):
        with pytest.raises(MentionDepthError):
            ensure_depth(depth)


def test_next_ring_goes_both_ways_and_never_repeats() -> None:
    a, b, c, d = _ids(4)
    links = [(a, b), (c, a), (b, d)]
    assert next_ring({a}, links, {a}) == {b, c}
    assert next_ring({b, c}, links, {a, b, c}) == {d}


def test_the_graph_walks_rings_and_draws_only_the_ties_to_the_center() -> None:
    a, b, c, d, e = _ids(5)
    names = {a: "A", b: "B", c: "C", d: "D", e: "E"}
    # A mentions B and C, D mentions A, B mentions C, E mentions D (two
    # steps), and a self mention is ignored.
    links = [(a, b), (a, c), (d, a), (b, c), (e, d), (a, a)]
    graph = mention_graph(a, 0, links, names)
    assert {card.document_id for card in graph.cards} == {a, b, c, d}
    # B mentions C, but only the relations with A are drawn.
    assert {(r.from_id, r.direction, r.to_id) for r in graph.relations} == {
        (a, ArrowDirection.FORWARD, b),
        (a, ArrowDirection.FORWARD, c),
        (d, ArrowDirection.FORWARD, a),
    }
    assert graph.left_out == 0

    deeper = mention_graph(a, 1, links, names)
    assert {card.document_id: card.step for card in deeper.cards}[e] == 2
    assert next(card for card in deeper.cards if card.document_id == e).parent_id == d
    # E is tied to D, the card that brought it in.
    assert (e, ArrowDirection.FORWARD, d) in {
        (r.from_id, r.direction, r.to_id) for r in deeper.relations
    }

    # Mentioning each other, twice over: one two-way relation.
    mutual = mention_graph(a, 0, [(b, a), (a, b), (a, b)], names)
    assert [(r.from_id, r.direction, r.to_id) for r in mutual.relations] == [
        (a, ArrowDirection.BOTH, b)
    ]


def test_the_cap_keeps_the_nearest_and_most_mentioned() -> None:
    center, near, strong, weak, far = _ids(5)
    names = {document_id: f"D{index}" for index, document_id in enumerate(_ids(5))}
    links = [
        (center, near),
        (center, strong),
        (center, strong),
        (center, weak),
        (strong, center),
        (near, far),
    ]
    graph = mention_graph(center, 1, links, names, limit=3)
    assert [card.document_id for card in graph.cards] == [center, strong, near]
    assert graph.left_out == 2
    assert all({r.from_id, r.to_id} <= {center, strong, near} for r in graph.relations)


def test_nothing_to_map_without_relations() -> None:
    (alone,) = _ids(1)
    with pytest.raises(NothingToMapError):
        ensure_something_to_map(mention_graph(alone, 0, [], {}))


def test_the_first_ring_sits_left_right_top_and_bottom() -> None:
    center, mentions_it, mentioned, mutual_1, mutual_2 = _ids(5)
    names = {center: "C", mentions_it: "L", mentioned: "R", mutual_1: "T", mutual_2: "U"}
    links = [
        (mentions_it, center),
        (center, mentioned),
        (center, mutual_1),
        (mutual_1, center),
        (center, mutual_2),
        (mutual_2, center),
    ]
    graph = mention_graph(center, 0, links, names)
    assert first_ring_side(center, mentions_it, graph) == Side.MENTIONS_CENTER
    assert first_ring_side(center, mentioned, graph) == Side.MENTIONED_BY_CENTER
    assert first_ring_side(center, mutual_1, graph) == Side.MUTUAL

    places = ring_layout(graph, names)
    assert places[center] == (-CARD_WIDTH / 2, -CARD_HEIGHT / 2)
    assert places[mentions_it][0] < places[center][0] < places[mentioned][0]
    assert places[mutual_1][1] < places[center][1] < places[mutual_2][1]


def test_outer_rings_grow_and_cards_never_overlap() -> None:
    center, hub, *leaves = _ids(40)
    names = {document_id: f"D{index:02}" for index, document_id in enumerate(_ids(40))}
    links = [(center, hub), *((hub, leaf) for leaf in leaves)]
    graph = mention_graph(center, 1, links, names)
    places = ring_layout(graph, names)
    assert len(places) == 40
    points = list(places.values())
    for index, (x1, y1) in enumerate(points):
        for x2, y2 in points[index + 1 :]:
            assert (x1 - x2) ** 2 + (y1 - y2) ** 2 >= (SLOT * 0.99) ** 2
    assert ring_layout(graph, names) == places


def test_place_around_spreads_evenly_when_crowded() -> None:
    assert _place_around([0.0, 0.0, 1.0], 0.5) == [0.0, 0.5, 1.0]
    crowded = _place_around([0.0] * 4, 2.0)
    assert crowded == pytest.approx([0.0, 1.5707963, 3.1415926, 4.7123889])
    assert _place_around([], 1.0) == []


def test_the_board_keeps_saved_places_and_colors() -> None:
    map_id, center, other = _ids(3)
    names = {center: "C", other: "O"}
    graph = mention_graph(center, 0, [(center, other)], names)
    saved = MapCard(
        id=mention_card_id(map_id, other),
        document_id=other,
        text=None,
        group_id=None,
        caption=None,
        size=CardSize.NORMAL,
        master_only=False,
        color=MapColor.RED,
        struck=False,
        x=5,
        y=6,
    )
    cards, arrows = mention_board(map_id, graph, names, [saved])
    by_document = {card.document_id: card for card in cards}
    assert by_document[center].color == MapColor.GOLD
    assert (by_document[other].x, by_document[other].y, by_document[other].color) == (
        5,
        6,
        MapColor.RED,
    )
    assert arrows[0].from_end.card_id == by_document[center].id
    assert arrows[0].to_end.card_id == saved.id
    assert mention_board(map_id, graph, names, [saved])[1][0].id == arrows[0].id


def test_a_crowded_first_ring_packs_tightly_without_overlaps() -> None:
    center, *others = _ids(31)
    names = {document_id: f"D{index:02}" for index, document_id in enumerate(_ids(31))}
    # Ten mention the center, ten are mentioned by it, ten both ways.
    links = [
        *((other, center) for other in others[:10]),
        *((center, other) for other in others[10:20]),
        *((center, other) for other in others[20:]),
        *((other, center) for other in others[20:]),
    ]
    graph = mention_graph(center, 0, links, names)
    places = ring_layout(graph, names)
    points = list(places.values())
    for index, (x1, y1) in enumerate(points):
        for x2, y2 in points[index + 1 :]:
            assert abs(x1 - x2) >= CARD_WIDTH or abs(y1 - y2) >= CARD_HEIGHT
    # 30 cards fit in three rings: none further than the third.
    cx, cy = places[center]
    assert all(math.hypot(x - cx, y - cy) <= FIRST_RING_RADIUS + 2 * SLOT + 1 for x, y in points)
    # Those mentioning the center stay on its left, those it mentions on its right.
    assert all(places[other][0] < cx for other in others[:10])
    assert all(places[other][0] > cx for other in others[10:20])


def _card(card_id: uuid.UUID, document_id: uuid.UUID | None, x: float, y: float) -> MapCard:
    return MapCard(
        id=card_id,
        document_id=document_id,
        text=None if document_id else "Note",
        group_id=None,
        caption=None,
        size=CardSize.NORMAL,
        master_only=False,
        color=MapColor.RED,
        struck=False,
        x=x,
        y=y,
    )


def _counter() -> Callable[[], uuid.UUID]:
    made = iter(uuid.UUID(int=1000 + index) for index in range(100))
    return lambda: next(made)


def test_adding_to_an_empty_board_lays_out_as_a_mention_map() -> None:
    a, b, c = _ids(3)
    names = {a: "A", b: "B", c: "C"}
    graph = mention_graph(a, 0, [(a, b), (c, a)], names)
    cards, arrows = add_to_board(Board(), graph, names, _counter())
    layout = ring_layout(graph, names)
    assert {card.document_id: (card.x, card.y) for card in cards} == layout
    assert next(card for card in cards if card.document_id == a).color == MapColor.GOLD
    by_document = {card.document_id: card.id for card in cards}
    assert {(arrow.from_end.card_id, arrow.to_end.card_id) for arrow in arrows} == {
        (by_document[a], by_document[b]),
        (by_document[c], by_document[a]),
    }


def test_adding_keeps_cards_already_there_and_their_arrows() -> None:
    a, b, c, d, card_a, card_b, other_a = _ids(7)
    names = {a: "A", b: "B", c: "C", d: "D"}
    graph = mention_graph(a, 0, [(a, b), (a, c), (d, a)], names)
    drawn = MapArrow(
        id=uuid.uuid4(),
        from_end=ArrowEnd(card_id=card_b),
        to_end=ArrowEnd(card_id=card_a),
        direction=ArrowDirection.NONE,
        label=None,
        reverse_label=None,
        color=MapColor.DEFAULT,
        master_only=False,
    )
    group_arrow = MapArrow(**{**vars(drawn), "to_end": ArrowEnd(group_id=uuid.uuid4())})
    board = Board(
        cards=[_card(card_a, a, 1000, 500), _card(card_b, b, 0, 0), _card(other_a, a, 9, 9)],
        arrows=[drawn, group_arrow],
    )
    cards, arrows = add_to_board(board, graph, names, _counter())
    # A and B keep their (first) card; C and D are placed around A's card.
    assert {card.document_id for card in cards} == {c, d}
    layout = ring_layout(graph, names)
    shift = (1000 - layout[a][0], 500 - layout[a][1])
    for card in cards:
        assert card.document_id is not None
        assert (card.x, card.y) == (
            layout[card.document_id][0] + shift[0],
            layout[card.document_id][1] + shift[1],
        )
        assert card.color == MapColor.DEFAULT
    # A → B is already drawn (the other way, as a line): not drawn again.
    by_document = {card.document_id: card.id for card in cards}
    assert {(arrow.from_end.card_id, arrow.to_end.card_id) for arrow in arrows} == {
        (card_a, by_document[c]),
        (by_document[d], card_a),
    }


def test_adding_beside_a_board_without_the_document() -> None:
    a, b, card_x, text_card = _ids(4)
    names = {a: "A", b: "B"}
    graph = mention_graph(a, 0, [(a, b)], names)
    group = MapGroup(
        id=uuid.uuid4(),
        title=None,
        color=MapColor.DEFAULT,
        struck=False,
        x=0,
        y=0,
        width=2000,
        height=1000,
    )
    board = Board(
        groups=[group], cards=[_card(card_x, uuid.uuid4(), 100, 100), _card(text_card, None, 0, 0)]
    )
    cards, _ = add_to_board(board, graph, names, _counter())
    # Right of the group (the board's right edge), centered on the board.
    left = min(card.x for card in cards)
    assert left == 2000 + SLOT - CARD_WIDTH
    top = min(card.y for card in cards)
    bottom = max(card.y for card in cards) + CARD_HEIGHT
    assert (top + bottom) / 2 == pytest.approx(500, abs=1)

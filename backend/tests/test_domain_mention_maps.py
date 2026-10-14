"""Mention maps (spec 36): the graph walked from the visible mentions, its
cap, and the ring layout."""

import uuid

import pytest

from app.domain.mention_maps import (
    CARD_HEIGHT,
    CARD_WIDTH,
    SLOT,
    MentionDepthError,
    NothingToMapError,
    Side,
    _place_around,
    ensure_depth,
    ensure_something_to_map,
    first_ring_side,
    mention_board,
    mention_card_id,
    mention_graph,
    next_ring,
    ring_layout,
)
from app.domain.relationship_maps import ArrowDirection, CardSize, MapCard, MapColor


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


def test_the_graph_walks_rings_and_draws_every_relation() -> None:
    a, b, c, d, e = _ids(5)
    names = {a: "A", b: "B", c: "C", d: "D", e: "E"}
    # A mentions B and C, D mentions A, B mentions C, E mentions D (two
    # steps), and a self mention is ignored.
    links = [(a, b), (a, c), (d, a), (b, c), (e, d), (a, a)]
    graph = mention_graph(a, 0, links, names)
    assert {card.document_id for card in graph.cards} == {a, b, c, d}
    assert {(r.from_id, r.direction, r.to_id) for r in graph.relations} == {
        (a, ArrowDirection.FORWARD, b),
        (a, ArrowDirection.FORWARD, c),
        (d, ArrowDirection.FORWARD, a),
        (b, ArrowDirection.FORWARD, c),
    }
    assert graph.left_out == 0

    deeper = mention_graph(a, 1, links, names)
    assert {card.document_id: card.step for card in deeper.cards}[e] == 2
    assert next(card for card in deeper.cards if card.document_id == e).parent_id == d

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

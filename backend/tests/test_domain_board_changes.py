"""Per-item saves (spec 43): an editor's changes laid over the stored board,
so another editor's work in the meantime is kept."""

import uuid
from dataclasses import replace

import pytest

from app.domain.geographic_maps import (
    Area,
    GeoBoard,
    LabelSide,
    Link,
    LinkEnd,
    Pin,
    merge_geo_changes,
)
from app.domain.relationship_maps import (
    ArrowDirection,
    ArrowEnd,
    Board,
    CardSize,
    InvalidBoardError,
    MapArrow,
    MapCard,
    MapColor,
    MapGroup,
    merge_board_changes,
    merge_items,
)

SQUARE = ((10.0, 10.0), (110.0, 10.0), (110.0, 110.0), (10.0, 110.0))


def _card(document_id: uuid.UUID | None = None, **fields: object) -> MapCard:
    card = MapCard(
        id=uuid.uuid4(),
        document_id=document_id,
        text=None if document_id else "the night of the fire",
        group_id=None,
        caption=None,
        size=CardSize.NORMAL,
        master_only=False,
        color=MapColor.DEFAULT,
        struck=False,
        x=0.0,
        y=0.0,
    )
    return replace(card, **fields)  # type: ignore[arg-type]


def _group(**fields: object) -> MapGroup:
    group = MapGroup(
        id=uuid.uuid4(),
        title="Camarilla",
        color=MapColor.DEFAULT,
        struck=False,
        x=100.0,
        y=50.0,
        width=300.0,
        height=200.0,
    )
    return replace(group, **fields)  # type: ignore[arg-type]


def _arrow(start: MapCard, end: MapCard) -> MapArrow:
    return MapArrow(
        id=uuid.uuid4(),
        from_end=ArrowEnd(card_id=start.id),
        to_end=ArrowEnd(card_id=end.id),
        direction=ArrowDirection.FORWARD,
        label="rival",
        reverse_label=None,
        color=MapColor.DEFAULT,
        master_only=False,
    )


def _merge(
    stored: Board,
    changed: Board,
    created: tuple[object, ...] = (),
    deleted: tuple[object, ...] = (),
    shown: Board | None = None,
) -> Board:
    return merge_board_changes(
        stored,
        stored if shown is None else shown,
        changed,
        {item.id for item in created},  # type: ignore[attr-defined]
        {item.id for item in deleted},  # type: ignore[attr-defined]
    )


# --- Laying changes over what is shown -----------------------------------------


def test_merge_items_replaces_adds_deletes_and_drops_what_is_not_shown() -> None:
    kept, moved, gone = _card(), _card(), _card()
    new, stale, hidden = _card(), _card(), _card()
    moved_now = replace(moved, x=40.0)
    every_id = {kept.id, moved.id, gone.id, hidden.id}
    merged = merge_items(
        [kept, moved, gone],
        # `stale` was deleted by someone else; `hidden` is on the map but not
        # shown, so even "created" it is no new item.
        [moved_now, new, replace(stale, x=9.0), hidden],
        {new.id, hidden.id},
        {gone.id},
        every_id,
    )
    assert merged == [kept, moved_now, new]


def test_another_editors_cards_survive_a_save_that_never_knew_them() -> None:
    mine, theirs = _card(), _card()
    stored = Board(cards=[mine, theirs])
    moved = replace(mine, x=120.0)
    merged = _merge(stored, Board(cards=[moved]))
    assert merged.cards == [moved, theirs]


def test_a_change_to_something_deleted_meanwhile_is_dropped_not_revived() -> None:
    survivor = _card()
    deleted_by_someone = _card()
    merged = _merge(Board(cards=[survivor]), Board(cards=[replace(deleted_by_someone, x=5.0)]))
    assert merged.cards == [survivor]


def test_a_new_card_and_a_deletion_apply() -> None:
    old, new = _card(), _card()
    merged = _merge(Board(cards=[old]), Board(cards=[new]), created=(new,), deleted=(old,))
    assert merged.cards == [new]


def test_the_same_id_twice_is_refused() -> None:
    card = _card()
    with pytest.raises(InvalidBoardError):
        _merge(Board(), Board(cards=[card, card]), created=(card,))


# --- Documents and arrows ---------------------------------------------------


def test_a_new_card_for_a_document_already_on_the_map_is_dropped() -> None:
    document_id = uuid.uuid4()
    stored_card = _card(document_id)
    late = _card(document_id)
    merged = _merge(Board(cards=[stored_card]), Board(cards=[late]), created=(late,))
    assert merged.cards == [stored_card]


def test_a_new_card_for_a_document_whose_card_is_hidden_is_dropped() -> None:
    document_id = uuid.uuid4()
    hidden = _card(document_id, master_only=True)
    late = _card(document_id)
    merged = _merge(Board(cards=[hidden]), Board(cards=[late]), created=(late,), shown=Board())
    assert merged.cards == []


def test_two_new_cards_for_one_document_keep_the_first() -> None:
    document_id = uuid.uuid4()
    first, second = _card(document_id), _card(document_id)
    merged = _merge(Board(), Board(cards=[first, second]), created=(first, second))
    assert merged.cards == [first]


def test_an_arrow_whose_end_is_gone_is_dropped() -> None:
    start, end = _card(), _card()
    arrow = _arrow(start, end)
    # Someone else deleted `end` while this editor drew the arrow.
    merged = _merge(Board(cards=[start]), Board(arrows=[arrow]), created=(arrow,))
    assert merged.arrows == []
    kept = _merge(Board(cards=[start, end]), Board(arrows=[arrow]), created=(arrow,))
    assert kept.arrows == [arrow]


# --- Groups that are gone ----------------------------------------------------


def test_a_card_in_a_group_deleted_here_stays_where_it_was_drawn() -> None:
    group = _group()
    # Added by someone else into the group this editor deletes.
    theirs = _card(group_id=group.id, x=10.0, y=20.0)
    merged = _merge(Board(groups=[group], cards=[theirs]), Board(), deleted=(group,))
    assert merged.groups == []
    assert merged.cards == [replace(theirs, group_id=None, x=110.0, y=70.0)]


def test_a_card_moved_into_a_group_someone_deleted_keeps_its_stored_place() -> None:
    stored = _card(x=300.0, y=400.0)
    gone_group = _group()
    moved = replace(stored, group_id=gone_group.id, x=5.0, y=5.0, color=MapColor.EMERALD)
    merged = _merge(Board(cards=[stored]), Board(cards=[moved]))
    assert merged.cards == [replace(moved, group_id=None, x=300.0, y=400.0)]


def test_a_card_whose_stored_group_is_still_there_goes_back_into_it() -> None:
    group = _group()
    stored = _card(group_id=group.id, x=20.0, y=30.0)
    gone_group = _group()
    moved = replace(stored, group_id=gone_group.id, x=5.0)
    merged = _merge(Board(groups=[group], cards=[stored]), Board(cards=[moved]))
    assert merged.cards == [replace(moved, group_id=group.id, x=20.0, y=30.0)]


def test_a_card_whose_groups_are_all_gone_is_simply_ungrouped() -> None:
    gone_before, gone_now = _group(), _group()
    # The stored card points at a group the stored board no longer has.
    stored = _card(group_id=gone_before.id)
    moved = replace(stored, group_id=gone_now.id, x=7.0)
    new = _card(group_id=gone_now.id, x=3.0)
    merged = _merge(Board(cards=[stored]), Board(cards=[moved, new]), created=(new,))
    assert merged.cards == [replace(moved, group_id=None), replace(new, group_id=None)]


def test_a_card_in_a_kept_group_is_left_alone() -> None:
    group = _group()
    card = _card(group_id=group.id, x=4.0)
    moved = replace(card, x=8.0)
    merged = _merge(Board(groups=[group], cards=[card]), Board(cards=[moved]))
    assert merged == Board(groups=[group], cards=[moved], arrows=[])


# --- Geographic maps ---------------------------------------------------------


def _area(document_id: uuid.UUID | None = None, **fields: object) -> Area:
    area = Area(
        id=uuid.uuid4(),
        document_id=document_id,
        name=None if document_id else "Bosco",
        subtitle=None,
        note=None,
        points=SQUARE,
        color=MapColor.EMERALD,
        dashed=False,
        filled=True,
        master_only=False,
    )
    return replace(area, **fields)  # type: ignore[arg-type]


def _pin(document_id: uuid.UUID | None = None, **fields: object) -> Pin:
    pin = Pin(
        id=uuid.uuid4(),
        document_id=document_id,
        name=None if document_id else "Shibuya 109",
        note=None,
        x=50.0,
        y=60.0,
        label_side=LabelSide.RIGHT,
        color=MapColor.DEFAULT,
        master_only=False,
    )
    return replace(pin, **fields)  # type: ignore[arg-type]


def _link(start: Area | Pin, end: Area | Pin) -> Link:
    def link_end(item: Area | Pin) -> LinkEnd:
        return LinkEnd(area_id=item.id) if isinstance(item, Area) else LinkEnd(pin_id=item.id)

    return Link(
        id=uuid.uuid4(),
        from_end=link_end(start),
        to_end=link_end(end),
        direction=ArrowDirection.FORWARD,
        label=None,
        reverse_label=None,
        color=MapColor.DEFAULT,
        master_only=False,
    )


def _merge_geo(
    stored: GeoBoard,
    changed: GeoBoard,
    created: tuple[Area | Pin | Link, ...] = (),
    deleted: tuple[Area | Pin | Link, ...] = (),
    shown: GeoBoard | None = None,
) -> GeoBoard:
    return merge_geo_changes(
        stored,
        stored if shown is None else shown,
        changed,
        {item.id for item in created},
        {item.id for item in deleted},
    )


def test_a_geographic_save_keeps_the_places_it_never_knew() -> None:
    mine, theirs = _pin(), _area()
    moved = replace(mine, x=70.0)
    gone = _pin()
    new = _area()
    merged = _merge_geo(
        GeoBoard(areas=[theirs], pins=[mine, gone]),
        GeoBoard(areas=[new], pins=[moved]),
        created=(new,),
        deleted=(gone,),
    )
    assert merged == GeoBoard(areas=[theirs, new], pins=[moved], links=[])


def test_a_new_place_for_a_document_already_placed_is_dropped() -> None:
    placed, hidden_doc, fresh = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    stored_pin = _pin(placed)
    hidden_area = _area(hidden_doc)
    late_area = _area(placed)
    late_pin = _pin(hidden_doc)
    first, second = _pin(fresh), _area(fresh)
    plain = _pin()
    merged = _merge_geo(
        GeoBoard(areas=[hidden_area], pins=[stored_pin]),
        GeoBoard(areas=[late_area, second], pins=[late_pin, first, plain]),
        created=(late_area, late_pin, first, second, plain),
        shown=GeoBoard(pins=[stored_pin]),
    )
    # Areas are claimed before pins, so `second` takes `fresh` from `first`.
    assert merged.areas == [second]
    assert merged.pins == [stored_pin, plain]


def test_a_link_whose_end_is_gone_is_dropped_and_the_same_id_twice_refused() -> None:
    start, end = _pin(), _area()
    link = _link(start, end)
    merged = _merge_geo(GeoBoard(pins=[start]), GeoBoard(links=[link]), created=(link,))
    assert merged.links == []
    kept = _merge_geo(GeoBoard(areas=[end], pins=[start]), GeoBoard(links=[link]), created=(link,))
    assert kept.links == [link]
    with pytest.raises(InvalidBoardError):
        _merge_geo(GeoBoard(), GeoBoard(pins=[start, start]), created=(start,))

import math
import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.domain.models import DocumentVisibility, RoomRole
from app.domain.relationship_maps import (
    MAP_VISIBILITY_CHANGED,
    MAX_ARROWS_PER_MAP,
    MAX_CAPTION_LENGTH,
    MAX_CARDS_PER_MAP,
    MAX_GROUPS_PER_MAP,
    MAX_LABEL_LENGTH,
    MAX_MAP_DESCRIPTION_LENGTH,
    MAX_MAP_NAME_LENGTH,
    MAX_MAPS_PER_ROOM,
    ArrowDirection,
    ArrowEnd,
    Board,
    BoardDocumentNotFoundError,
    BoardPlan,
    CardSize,
    InvalidBoardError,
    MapArrow,
    MapCard,
    MapColor,
    MapGroup,
    MapLimitError,
    MapNameRequiredError,
    MapTextTooLongError,
    MasterOnlyNotAllowedError,
    RelationshipMap,
    TooManyMapsError,
    can_create_map,
    can_manage_map,
    clean_line,
    clean_lines,
    clean_map_fields,
    document_card_counts,
    ensure_room_for_another_map,
    is_map_visible,
    label_suggestions,
    map_visibility_audit,
    plan_board_edit,
    visible_arrows,
    visible_board,
    visible_cards,
    visible_groups,
)

CREATOR = uuid.uuid4()
OTHER = uuid.uuid4()
NOW = datetime(2026, 10, 12, tzinfo=UTC)


def _map(visibility: DocumentVisibility = DocumentVisibility.ROOM) -> RelationshipMap:
    return RelationshipMap(
        id=uuid.uuid4(),
        room_id=uuid.uuid4(),
        name="Court",
        description="",
        visibility=visibility,
        created_by=CREATOR,
        created_at=NOW,
        updated_at=NOW,
    )


def _doc_card(document_id: uuid.UUID, **fields: object) -> MapCard:
    card = MapCard(
        id=uuid.uuid4(),
        document_id=document_id,
        text=None,
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


def _text_card(text: str = "the night of the fire", **fields: object) -> MapCard:
    card = MapCard(
        id=uuid.uuid4(),
        document_id=None,
        text=text,
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


def _group(title: str | None = None, **fields: object) -> MapGroup:
    group = MapGroup(
        id=uuid.uuid4(),
        title=title,
        color=MapColor.DEFAULT,
        struck=False,
        x=0.0,
        y=0.0,
        width=200.0,
        height=100.0,
    )
    return replace(group, **fields)  # type: ignore[arg-type]


def _arrow(
    from_end: ArrowEnd, to_end: ArrowEnd, label: str | None = None, **fields: object
) -> MapArrow:
    arrow = MapArrow(
        id=uuid.uuid4(),
        from_end=from_end,
        to_end=to_end,
        direction=ArrowDirection.FORWARD,
        label=label,
        reverse_label=None,
        color=MapColor.DEFAULT,
        master_only=False,
    )
    return replace(arrow, **fields)  # type: ignore[arg-type]


def _card_end(card: MapCard) -> ArrowEnd:
    return ArrowEnd(card_id=card.id)


def _group_end(group: MapGroup) -> ArrowEnd:
    return ArrowEnd(group_id=group.id)


# --- Who may do what ----------------------------------------------------------


def test_every_master_creates_maps_and_players_only_when_allowed() -> None:
    assert can_create_map(RoomRole.MASTER, False)
    assert can_create_map(RoomRole.PLAYER, True)
    assert not can_create_map(RoomRole.PLAYER, False)


def test_the_creator_and_the_master_manage_a_map() -> None:
    relationship_map = _map()
    assert can_manage_map(relationship_map, CREATOR, RoomRole.PLAYER)
    assert can_manage_map(relationship_map, OTHER, RoomRole.MASTER)
    assert not can_manage_map(relationship_map, OTHER, RoomRole.PLAYER)


def test_a_map_uses_the_comment_levels_with_its_creator_as_owner() -> None:
    private = _map(DocumentVisibility.PRIVATE)
    assert is_map_visible(private, CREATOR, RoomRole.PLAYER, [])
    assert not is_map_visible(private, OTHER, RoomRole.PLAYER, [])
    assert is_map_visible(private, OTHER, RoomRole.MASTER, [])
    selective = _map(DocumentVisibility.SELECTIVE)
    assert is_map_visible(selective, OTHER, RoomRole.PLAYER, [OTHER])
    assert not is_map_visible(_map(DocumentVisibility.MASTER), CREATOR, RoomRole.PLAYER, [])


# --- What a viewer sees -------------------------------------------------------


def test_a_hidden_document_card_and_a_master_only_text_card_are_absent() -> None:
    seen, hidden = uuid.uuid4(), uuid.uuid4()
    shown_card = _doc_card(seen)
    hidden_card = _doc_card(hidden)
    secret = _text_card(master_only=True)
    note = _text_card()
    cards = [shown_card, hidden_card, secret, note]

    assert visible_cards(cards, {seen}, RoomRole.PLAYER) == [shown_card, note]
    assert visible_cards(cards, {seen, hidden}, RoomRole.MASTER) == cards


def test_a_group_hides_only_when_untitled_and_all_its_cards_are_hidden() -> None:
    empty = _group()
    titled = _group("Adversaries and Enemies")
    hiding = _group()
    partly = _group()
    hidden_in_titled = _doc_card(uuid.uuid4(), group_id=titled.id)
    hidden_in_hiding = _doc_card(uuid.uuid4(), group_id=hiding.id)
    shown_in_partly = _text_card(group_id=partly.id)
    hidden_in_partly = _doc_card(uuid.uuid4(), group_id=partly.id)
    free = _text_card()
    cards = [hidden_in_titled, hidden_in_hiding, shown_in_partly, hidden_in_partly, free]

    groups = visible_groups([empty, titled, hiding, partly], cards, [shown_in_partly, free])

    assert groups == [empty, titled, partly]


def test_an_arrow_shows_only_when_both_ends_show_and_master_only_to_a_master() -> None:
    a, b = _text_card(), _text_card()
    hidden = _text_card()
    group = _group("Court")
    gone_group = _group()
    plain = _arrow(_card_end(a), _card_end(b))
    to_group = _arrow(_card_end(a), _group_end(group))
    to_hidden = _arrow(_card_end(a), _card_end(hidden))
    from_hidden_group = _arrow(_group_end(gone_group), _card_end(b))
    secret = _arrow(_card_end(a), _card_end(b), master_only=True)
    arrows = [plain, to_group, to_hidden, from_hidden_group, secret]

    shown = visible_arrows(arrows, {a.id, b.id}, {group.id}, RoomRole.PLAYER)
    assert shown == [plain, to_group]
    assert visible_arrows(arrows, {a.id, b.id}, {group.id}, RoomRole.MASTER) == [
        plain,
        to_group,
        secret,
    ]


def test_visible_board_drops_a_hidden_document_with_every_arrow_touching_it() -> None:
    aldric, mira, thorn = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    aldric_card, mira_card, thorn_card = _doc_card(aldric), _doc_card(mira), _doc_card(thorn)
    fire = _text_card()
    alliance = _arrow(
        _card_end(mira_card),
        _card_end(thorn_card),
        "ally of",
        direction=ArrowDirection.BOTH,
        reverse_label="ally of",
    )
    father = _arrow(_card_end(aldric_card), _card_end(mira_card), "father of", master_only=True)
    board = Board(cards=[aldric_card, mira_card, thorn_card, fire], arrows=[alliance, father])

    player = visible_board(board, {aldric, mira, thorn}, RoomRole.PLAYER)
    assert player.cards == [aldric_card, mira_card, thorn_card, fire]
    assert player.arrows == [alliance]

    without_thorn = visible_board(board, {aldric, mira}, RoomRole.PLAYER)
    assert without_thorn.cards == [aldric_card, mira_card, fire]
    assert without_thorn.arrows == []

    master = visible_board(board, {aldric, mira, thorn}, RoomRole.MASTER)
    assert master.arrows == [alliance, father]


def test_label_suggestions_are_most_used_first_then_alphabetical() -> None:
    a, b = ArrowEnd(card_id=uuid.uuid4()), ArrowEnd(card_id=uuid.uuid4())
    arrows = [
        _arrow(a, b, "rival"),
        _arrow(a, b, "ally of", direction=ArrowDirection.BOTH, reverse_label="ally of"),
        _arrow(a, b, "Brother"),
        _arrow(a, b, None),
    ]
    assert label_suggestions(arrows) == ["ally of", "Brother", "rival"]


# --- Cleaning -----------------------------------------------------------------


def test_clean_line_collapses_whitespace_and_checks_the_limit() -> None:
    assert clean_line(None, 10, "label") is None
    assert clean_line("  ally   of ", 10, "label") == "ally of"
    assert clean_line("   ", 10, "label") is None
    with pytest.raises(MapTextTooLongError) as error:
        clean_line("x" * (MAX_LABEL_LENGTH + 1), MAX_LABEL_LENGTH, "label")
    assert error.value.params == {"field": "@errors.map.fields.label", "max": MAX_LABEL_LENGTH}


def test_clean_lines_keeps_lines_and_joins_the_ones_past_the_maximum() -> None:
    assert clean_lines(None, 10, "text") is None
    assert clean_lines(" \n  ", 10, "text") is None
    assert clean_lines("\n Eliza  Costa \n\n Anthony \n", 100, "text") == "Eliza Costa\n\nAnthony"
    assert clean_lines("one\ntwo\nthree", 100, "caption", 2) == "one\ntwo three"
    with pytest.raises(MapTextTooLongError):
        clean_lines("x" * (MAX_CAPTION_LENGTH + 1), MAX_CAPTION_LENGTH, "caption", 2)


def test_clean_map_fields_requires_a_name_and_caps_both_fields() -> None:
    assert clean_map_fields("  The  Court ", "  Who\nserves whom ") == (
        "The Court",
        "Who\nserves whom",
    )
    assert clean_map_fields("Court", "") == ("Court", "")
    with pytest.raises(MapNameRequiredError):
        clean_map_fields("   ", "")
    with pytest.raises(MapTextTooLongError):
        clean_map_fields("x" * (MAX_MAP_NAME_LENGTH + 1), "")
    with pytest.raises(MapTextTooLongError):
        clean_map_fields("Court", "x" * (MAX_MAP_DESCRIPTION_LENGTH + 1))


def test_a_room_holds_at_most_the_maximum_number_of_maps() -> None:
    ensure_room_for_another_map(MAX_MAPS_PER_ROOM - 1)
    with pytest.raises(TooManyMapsError):
        ensure_room_for_another_map(MAX_MAPS_PER_ROOM)


def test_map_visibility_audit_records_a_level_or_grant_change_only() -> None:
    before = _map(DocumentVisibility.ROOM)
    assert map_visibility_audit(before, replace(before, name="x"), OTHER, [], None) is None
    assert map_visibility_audit(before, before, OTHER, [OTHER], [OTHER]) is None

    level = map_visibility_audit(
        before, replace(before, visibility=DocumentVisibility.MASTER), OTHER, [CREATOR], None
    )
    assert level is not None
    assert level.action == MAP_VISIBILITY_CHANGED
    assert level.room_id == before.room_id
    assert level.actor_user_id == OTHER
    assert level.details == {
        "map_id": str(before.id),
        "from": "room",
        "to": "master",
        "selective_user_ids": [str(CREATOR)],
    }

    grants = map_visibility_audit(before, before, OTHER, [], [OTHER])
    assert grants is not None
    assert grants.details["selective_user_ids"] == [str(OTHER)]


# --- Saving a board -----------------------------------------------------------


def _plan(
    current: Board,
    submitted: Board,
    role: RoomRole = RoomRole.MASTER,
    visible: set[uuid.UUID] | None = None,
    foreign: frozenset[uuid.UUID] = frozenset(),
) -> BoardPlan:
    documents = (
        visible
        if visible is not None
        else {card.document_id for card in [*current.cards, *submitted.cards] if card.document_id}
    )
    shown = visible_board(current, documents, role)
    return plan_board_edit(current, shown, submitted, role, documents, foreign)


def test_a_new_board_is_created_with_its_texts_cleaned() -> None:
    document = uuid.uuid4()
    group = _group("  Adversaries   and Enemies ")
    card = _doc_card(document, group_id=group.id, caption=" Neonate \n Former Baron ", text="x")
    text = _text_card("  New   Ideas ", size=CardSize.TITLE, color=MapColor.GOLD)
    arrow = _arrow(_card_end(text), _group_end(group), " reliable ", reverse_label="dropped")
    two_way = _arrow(
        _card_end(card),
        _card_end(text),
        "Reliable",
        direction=ArrowDirection.BOTH,
        reverse_label=" Brother in the Cause ",
    )

    plan = _plan(Board(), Board(groups=[group], cards=[card, text], arrows=[arrow, two_way]))

    assert plan.groups[0].title == "Adversaries and Enemies"
    assert plan.cards[0].caption == "Neonate\nFormer Baron"
    assert plan.cards[0].text is None
    assert plan.cards[1].text == "New Ideas"
    assert plan.cards[1].size == CardSize.TITLE
    assert plan.arrows[0].label == "reliable"
    assert plan.arrows[0].reverse_label is None
    assert plan.arrows[1].reverse_label == "Brother in the Cause"
    assert not plan.delete_group_ids and not plan.delete_card_ids and not plan.delete_arrow_ids


def test_a_document_card_keeps_no_size_or_master_only_of_its_own() -> None:
    card = _doc_card(uuid.uuid4(), size=CardSize.TITLE, master_only=True)
    plan = _plan(Board(), Board(cards=[card]))
    assert plan.cards[0].size == CardSize.NORMAL
    assert plan.cards[0].master_only is False


def test_what_the_editor_sees_and_leaves_out_is_deleted() -> None:
    group, card, other = _group(), _text_card(), _text_card()
    arrow = _arrow(_card_end(card), _card_end(other))
    current = Board(groups=[group], cards=[card, other], arrows=[arrow])

    plan = _plan(current, Board(cards=[other]))

    assert plan.delete_group_ids == {group.id}
    assert plan.delete_card_ids == {card.id}
    assert plan.delete_arrow_ids == {arrow.id}
    assert [c.id for c in plan.cards] == [other.id]


def test_a_players_edit_leaves_the_cards_hidden_from_them_alone() -> None:
    mira, thorn = uuid.uuid4(), uuid.uuid4()
    mira_card, thorn_card = _doc_card(mira), _doc_card(thorn)
    fire = _text_card()
    arrow = _arrow(_card_end(mira_card), _card_end(thorn_card))
    current = Board(cards=[mira_card, thorn_card, fire], arrows=[arrow])

    moved = replace(mira_card, x=300.0)
    plan = _plan(current, Board(cards=[moved, fire]), RoomRole.PLAYER, {mira})

    assert [c.id for c in plan.cards] == [mira_card.id, fire.id]
    assert plan.cards[0].x == 300.0
    assert not plan.delete_card_ids
    assert not plan.delete_arrow_ids


def test_deleting_a_group_leaves_its_hidden_cards_where_they_were_drawn() -> None:
    seen, hidden = uuid.uuid4(), uuid.uuid4()
    group = _group("Corte", x=300.0, y=-50.0)
    far = _group("Lontano", x=99_990.0, y=0.0)
    shown_card = _doc_card(seen, group_id=group.id, x=10.0, y=20.0)
    hidden_card = _doc_card(hidden, group_id=group.id, x=40.0, y=60.0)
    hidden_far = _doc_card(uuid.uuid4(), group_id=far.id, x=50.0, y=0.0)
    current = Board(groups=[group, far], cards=[shown_card, hidden_card, hidden_far])

    released = replace(shown_card, group_id=None, x=310.0, y=-30.0)
    plan = _plan(current, Board(cards=[released]), RoomRole.PLAYER, {seen})

    assert plan.delete_group_ids == {group.id, far.id}
    assert plan.cards == [
        released,
        replace(hidden_card, group_id=None, x=340.0, y=10.0),
        replace(hidden_far, group_id=None, x=100_000.0, y=0.0),
    ]


@pytest.mark.parametrize("kind", ["group", "card", "arrow"])
def test_a_repeated_id_is_refused(kind: str) -> None:
    a, b = _text_card(), _text_card()
    group = _group()
    arrow = _arrow(_card_end(a), _card_end(b))
    submitted = {
        "group": Board(groups=[group, group]),
        "card": Board(cards=[a, a]),
        "arrow": Board(cards=[a, b], arrows=[arrow, arrow]),
    }[kind]
    with pytest.raises(InvalidBoardError):
        _plan(Board(), submitted)


def test_one_id_for_two_kinds_or_from_another_map_is_refused() -> None:
    card = _text_card()
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(groups=[_group(id=card.id)], cards=[card]))
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(cards=[card]), foreign=frozenset({card.id}))


def test_an_id_of_something_hidden_from_the_editor_is_refused() -> None:
    hidden_document = uuid.uuid4()
    hidden = _doc_card(hidden_document)
    secret = _text_card(master_only=True)
    a, b = _text_card(), _text_card()
    secret_arrow = _arrow(_card_end(a), _card_end(b), master_only=True)
    hiding_group = _group()
    in_group = replace(hidden, group_id=hiding_group.id)
    current = Board(groups=[hiding_group], cards=[in_group, secret, a, b], arrows=[secret_arrow])

    for submitted in (
        Board(cards=[_text_card(id=hidden.id), a, b]),
        Board(cards=[replace(secret, master_only=False), a, b]),
        Board(cards=[a, b], arrows=[replace(secret_arrow, master_only=False)]),
        Board(groups=[hiding_group], cards=[a, b]),
    ):
        with pytest.raises(InvalidBoardError):
            _plan(current, submitted, RoomRole.PLAYER, set())


def test_an_existing_id_sent_as_another_kind_is_refused() -> None:
    card = _text_card()
    current = Board(cards=[card])
    with pytest.raises(InvalidBoardError):
        _plan(current, Board(groups=[_group(id=card.id)], cards=[card]))
    with pytest.raises(InvalidBoardError):
        _plan(current, Board(groups=[_group(id=card.id)]))


def test_a_card_cannot_change_its_document_or_kind() -> None:
    document = uuid.uuid4()
    card = _doc_card(document)
    with pytest.raises(InvalidBoardError):
        _plan(Board(cards=[card]), Board(cards=[replace(card, document_id=uuid.uuid4())]))
    with pytest.raises(InvalidBoardError):
        _plan(
            Board(cards=[card]),
            Board(cards=[replace(card, document_id=None, text="now text")]),
        )


def test_a_text_card_needs_text() -> None:
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(cards=[_text_card("   ")]))
    with pytest.raises(MapTextTooLongError):
        _plan(Board(), Board(cards=[_text_card("x" * 301)]))


def test_a_document_the_editor_doesnt_see_is_not_found() -> None:
    with pytest.raises(BoardDocumentNotFoundError):
        _plan(Board(), Board(cards=[_doc_card(uuid.uuid4())]), RoomRole.PLAYER, set())


def test_a_document_appears_at_most_once_hidden_cards_included() -> None:
    document = uuid.uuid4()
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(cards=[_doc_card(document), _doc_card(document)]))
    # A Master-only text card hides nothing about Documents, but a Document
    # card the editor can't see still holds its Document's place.
    hidden = _doc_card(document)
    with pytest.raises(InvalidBoardError):
        plan_board_edit(
            Board(cards=[hidden]),
            Board(),
            Board(cards=[_doc_card(document)]),
            RoomRole.PLAYER,
            {document},
        )


def test_a_card_in_a_group_not_on_the_board_is_refused() -> None:
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(cards=[_text_card(group_id=uuid.uuid4())]))


def test_an_arrow_end_not_on_the_board_or_to_itself_is_refused() -> None:
    a, b = _text_card(), _text_card()
    group = _group()
    for arrow in (
        _arrow(_card_end(a), ArrowEnd(card_id=uuid.uuid4())),
        _arrow(_card_end(a), ArrowEnd(group_id=uuid.uuid4())),
        _arrow(_card_end(a), _card_end(a)),
        _arrow(_group_end(group), _group_end(group)),
    ):
        with pytest.raises(InvalidBoardError):
            _plan(Board(), Board(groups=[group], cards=[a, b], arrows=[arrow]))


def test_only_a_master_marks_something_master_only() -> None:
    a, b = _text_card(), _text_card()
    with pytest.raises(MasterOnlyNotAllowedError):
        _plan(Board(), Board(cards=[_text_card(master_only=True)]), RoomRole.PLAYER, set())
    with pytest.raises(MasterOnlyNotAllowedError):
        _plan(
            Board(),
            Board(cards=[a, b], arrows=[_arrow(_card_end(a), _card_end(b), master_only=True)]),
            RoomRole.PLAYER,
            set(),
        )
    plan = _plan(Board(), Board(cards=[_text_card(master_only=True)]))
    assert plan.cards[0].master_only is True


@pytest.mark.parametrize(
    ("x", "y"), [(math.inf, 0.0), (0.0, math.nan), (100_001.0, 0.0), (0.0, -100_001.0)]
)
def test_a_card_position_out_of_range_is_refused(x: float, y: float) -> None:
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(cards=[_text_card(x=x, y=y)]))


@pytest.mark.parametrize(
    ("width", "height"), [(39.0, 100.0), (100.0, 39.0), (20_001.0, 100.0), (100.0, 20_001.0)]
)
def test_a_group_size_out_of_range_is_refused(width: float, height: float) -> None:
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(groups=[_group(width=width, height=height)]))


def test_a_group_position_out_of_range_is_refused() -> None:
    with pytest.raises(InvalidBoardError):
        _plan(Board(), Board(groups=[_group(x=math.inf)]))


def test_the_caps_count_hidden_cards_groups_and_arrows() -> None:
    hidden_document = uuid.uuid4()
    hidden = _doc_card(hidden_document)
    hidden_group = _group()
    in_hidden_group = _doc_card(uuid.uuid4(), group_id=hidden_group.id)
    current = Board(groups=[hidden_group], cards=[hidden, in_hidden_group])

    cards = [_text_card() for _ in range(MAX_CARDS_PER_MAP - 1)]
    with pytest.raises(MapLimitError) as error:
        _plan(current, Board(cards=cards), RoomRole.PLAYER, set())
    assert error.value.key == "errors.map.tooManyCards"

    groups = [_group() for _ in range(MAX_GROUPS_PER_MAP)]
    with pytest.raises(MapLimitError) as error:
        _plan(current, Board(groups=groups), RoomRole.PLAYER, set())
    assert error.value.key == "errors.map.tooManyGroups"


def test_the_arrow_cap_counts_hidden_arrows_that_survive_the_edit() -> None:
    a, b = _text_card(), _text_card()
    secret_arrows = [
        _arrow(_card_end(a), _card_end(b), master_only=True) for _ in range(MAX_ARROWS_PER_MAP)
    ]
    current = Board(cards=[a, b], arrows=secret_arrows)
    new_arrow = _arrow(_card_end(a), _card_end(b))

    with pytest.raises(MapLimitError) as error:
        _plan(current, Board(cards=[a, b], arrows=[new_arrow]), RoomRole.PLAYER, set())
    assert error.value.key == "errors.map.tooManyArrows"

    # Deleting card `b` takes the hidden arrows with it: they no longer count.
    c = _text_card()
    plan = _plan(
        current,
        Board(cards=[a, c], arrows=[_arrow(_card_end(a), _card_end(c))]),
        RoomRole.PLAYER,
        set(),
    )
    assert plan.delete_card_ids == {b.id}


def test_document_card_counts_count_only_visible_documents() -> None:
    seen, hidden = uuid.uuid4(), uuid.uuid4()
    first, second = uuid.uuid4(), uuid.uuid4()
    counts = document_card_counts(
        {first: [_doc_card(seen), _doc_card(hidden), _text_card()], second: []}, {seen}
    )
    assert counts == {first: 1, second: 0}


def test_an_arrow_end_names_its_card_or_its_group() -> None:
    card_id, group_id = uuid.uuid4(), uuid.uuid4()
    assert ArrowEnd(card_id=card_id).id == card_id
    assert ArrowEnd(group_id=group_id).id == group_id

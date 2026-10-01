import uuid

import pytest

from app.domain.errors import DomainError
from app.domain.models import Tag, TagCombination
from app.domain.tags import (
    DuplicateCombinationError,
    DuplicateMainTagError,
    EmptyMainItemError,
    PlannedCombination,
    UnknownMainTagError,
    ordered_main_items,
    plan_main_items,
    plan_tag_removal,
)

A, B, C, D = (uuid.uuid4() for _ in range(4))
ROOM = [A, B, C, D]


def _tag(tag_id: uuid.UUID, position: int | None) -> Tag:
    """A Tag of a Room with this Main Tag position."""
    return Tag(
        id=tag_id, room_id=uuid.uuid4(), name=str(tag_id), category=None, main_position=position
    )


def _combo(position: int, *tag_ids: uuid.UUID) -> TagCombination:
    """A combination at this position."""
    return TagCombination(id=uuid.uuid4(), room_id=uuid.uuid4(), position=position, tag_ids=tag_ids)


def test_single_items_get_their_index_and_the_rest_are_cleared() -> None:
    """One-Tag items are Main Tags at their place in the list."""
    plan = plan_main_items(ROOM, [[C], [A]])

    assert plan.tag_positions == {C: 0, A: 1, B: None, D: None}
    assert plan.combinations == ()


def test_a_combination_takes_its_place_in_the_same_numbering() -> None:
    """Spec 11_2: singles and combinations interleave."""
    plan = plan_main_items(ROOM, [[A], [B, C], [D]])

    assert plan.tag_positions[A] == 0
    assert plan.tag_positions[D] == 2
    assert [(c.position, c.tag_ids) for c in plan.combinations] == [(1, (B, C))]


def test_a_tag_can_be_single_and_in_combinations() -> None:
    """Being in a combination doesn't use a Tag up."""
    plan = plan_main_items(ROOM, [[A], [A, B], [A, C]])

    assert plan.tag_positions[A] == 0
    assert len(plan.combinations) == 2


def test_an_empty_list_clears_everything() -> None:
    """Replaces the selection wholesale."""
    plan = plan_main_items(ROOM, [])

    assert set(plan.tag_positions.values()) == {None}
    assert plan.combinations == ()


@pytest.mark.parametrize(
    ("items", "error", "key"),
    [
        ([[]], EmptyMainItemError, "errors.tag.emptyMainItem"),
        ([[A], [A]], DuplicateMainTagError, "errors.tag.duplicateMainTag"),
        ([[A, A]], DuplicateMainTagError, "errors.tag.duplicateMainTag"),
        ([[A, B], [B, A]], DuplicateCombinationError, "errors.tag.duplicateCombination"),
        ([[uuid.uuid4()]], UnknownMainTagError, "errors.tag.unknownMainTag"),
        ([[A, uuid.uuid4()]], UnknownMainTagError, "errors.tag.unknownMainTag"),
    ],
)
def test_invalid_lists_are_rejected(
    items: list[list[uuid.UUID]], error: type[DomainError], key: str
) -> None:
    """Each rule has its own error and translation key."""
    with pytest.raises(error) as exc_info:
        plan_main_items(ROOM, items)

    assert exc_info.value.key == key


def test_ordered_main_items_merges_singles_and_combinations_by_position() -> None:
    """Read side of the same numbering; Tags without a position are skipped."""
    tags = [_tag(A, 2), _tag(B, None), _tag(C, 0)]
    combinations = [_combo(1, A, B)]

    assert ordered_main_items(tags, combinations) == [(C,), (A, B), (A,)]


def test_removing_a_tag_shrinks_the_combinations_that_held_it() -> None:
    """Spec 13: a combination of three keeps its other two Tags and its place."""
    plan = plan_tag_removal(C, [_combo(1, A, B, C)])

    assert plan == (PlannedCombination(1, (A, B)),)


def test_a_combination_left_with_one_tag_is_dropped() -> None:
    """One Tag would repeat a Main Tag item, which plan_main_items refuses."""
    assert plan_tag_removal(A, [_combo(0, A, B)]) == ()


def test_a_combination_without_the_tag_is_untouched() -> None:
    """Only combinations holding the Tag change."""
    assert plan_tag_removal(D, [_combo(2, A, B)]) == (PlannedCombination(2, (A, B)),)


def test_a_shrunken_combination_equal_to_another_keeps_the_earlier_one() -> None:
    """[A,B,C] and [A,B] both become {A,B}: the one at the lower position stays."""
    plan = plan_tag_removal(C, [_combo(3, A, B), _combo(1, A, B, C)])

    assert plan == (PlannedCombination(1, (A, B)),)
